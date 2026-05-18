//! Unified Udemy CLI: crawl, scrape (ingest), and search.
//!
//! Usage:
//!   cargo run --bin udemy -- crawl --output ./data/crawled-courses.json
//!   cargo run --bin udemy -- scrape --json ./data/courses.json
//!   cargo run --bin udemy -- search "docker kubernetes deployment"

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use aer_ml::content::courses;
use aer_ml::udemy::coursera::{
    parse_article_html, parse_articles_index, parse_coursera_links, parse_coursera_page,
};
use aer_ml::udemy::crawler::{CrawlConfig, FetchResult, UdemyClient};
use aer_ml::udemy::deeplearning;
use aer_ml::udemy::keywords::{
    classify_topic_group, is_rag_deep_slug, is_relevant, match_slugs, should_follow_topic,
    COURSERA_ARTICLES_INDEX, COURSERA_RAG_SEED_ARTICLES, COURSERA_RAG_SEED_COURSES,
    COURSERA_SEED_ARTICLES, DEEPLEARNING_COURSES_INDEX, DEEPLEARNING_RAG_SEED_COURSES,
    DEEPLEARNING_SEED_COURSES,
    RAG_SEED_QUERIES, SEED_TOPICS,
};
use aer_ml::udemy::scraper::{load_courses_json, parse_course_html};
use aer_ml::udemy::types::{
    Chapter, CrawlStats, ExternalCourseJson, SlugMapping, UdemyCourseJson,
};
use aer_ml::udemy::embed::{embed_batch, embed_one};
use aer_ml::udemy::generate::{generate_article, GenerateConfig};
use aer_ml::udemy::{Course, CourseStore};

#[derive(Parser)]
#[command(name = "udemy", about = "Udemy course pipeline: crawl, ingest, search")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// BFS-crawl Udemy topics and fetch course pages in parallel
    Crawl {
        /// Output JSON file path
        #[arg(long, default_value = "./data/crawled-courses.json")]
        output: PathBuf,

        /// Max concurrent topic page fetches
        #[arg(long, default_value_t = 4)]
        topic_concurrency: usize,

        /// Max concurrent course page fetches
        #[arg(long, default_value_t = 8)]
        course_concurrency: usize,

        /// Delay between batches in milliseconds
        #[arg(long, default_value_t = 1000)]
        delay_ms: u64,

        /// Also embed and store in LanceDB
        #[arg(long)]
        embed: bool,

        /// LanceDB path (only used with --embed)
        #[arg(long, default_value = "./lance-db")]
        db: String,

        /// Embed server URL (only used with --embed)
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,

        /// Batch size for embedding
        #[arg(long, default_value_t = 8)]
        embed_batch: usize,
    },

    /// Ingest courses from JSON into a Lance vector store
    Scrape {
        /// Path to a JSON file with course data
        #[arg(long)]
        json: PathBuf,

        /// Where to create / open the Lance database
        #[arg(long, default_value = "./lance-db")]
        db: String,

        /// Candle embed server URL
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,

        /// How many courses to embed per batch
        #[arg(long, default_value_t = 8)]
        batch: usize,
    },

    /// Add one or more courses by URL (fetch → parse → embed → store)
    Add {
        /// Course URLs (e.g. https://www.udemy.com/course/css-grid/)
        urls: Vec<String>,

        /// Output JSON file (written alongside embed/store)
        #[arg(long)]
        output: Option<PathBuf>,

        /// LanceDB path
        #[arg(long, default_value = "./lance-db")]
        db: String,

        /// Embed server URL
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,

        /// Skip embedding + LanceDB storage (just fetch & parse)
        #[arg(long)]
        no_embed: bool,
    },

    /// Semantic search over embedded Udemy courses
    Search {
        /// The search query
        query: String,

        /// Lance database path
        #[arg(long, default_value = "./lance-db")]
        db: String,

        /// Number of results to return
        #[arg(long, short, default_value_t = 5)]
        top: usize,

        /// Candle embed server URL
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,
    },

    /// Store / extract course chapter structure in LanceDB
    Chapters {
        #[command(subcommand)]
        action: ChapterAction,
    },

    /// Generate a knowledge-base article grounded on the Udemy corpus
    Generate {
        #[arg(long)]
        slug: String,
        #[arg(long)]
        topic: Option<String>,
        #[arg(long, default_value = "")]
        category: String,
        #[arg(long, default_value = "")]
        related: String,
        #[arg(long, default_value = "./lance-db")]
        db: String,
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,
        #[arg(long, default_value = "../../content")]
        content_dir: PathBuf,
        #[arg(long)]
        model: Option<String>,
        #[arg(long, default_value_t = 5)]
        top_courses: usize,
        #[arg(long, default_value_t = 8)]
        top_chapters: usize,
        #[arg(long, default_value_t = 2)]
        max_revisions: usize,
        #[arg(long, default_value_t = 16384)]
        max_tokens: u32,
        #[arg(long)]
        env_file: Option<PathBuf>,
        #[arg(long)]
        no_write: bool,
    },

    /// RAG-focused seed: scrape Udemy for every phase-3-rag lesson's courses
    /// via the Playwright subprocess, relevance-filter + slug-map them, and
    /// upsert into data/courses.db so they render on /rag lesson pages.
    RagSeed {
        /// Max candidates to scrape per RAG search query.
        #[arg(long, default_value_t = 15)]
        max: usize,

        /// Dedicated SQLite course store (read by `export-content`).
        #[arg(long, default_value = "../../data/courses.db")]
        courses_db: PathBuf,

        /// Knowledge-app root — cwd for the TS scraper subprocess.
        #[arg(long, default_value = "../..")]
        repo_root: PathBuf,

        /// Print the course→slug mapping table and exit (no DB writes).
        #[arg(long)]
        dry_run: bool,
    },

    /// BFS-crawl Coursera /articles/* pages from the articles index (+ seed
    /// slugs), relevance-filter them, and emit ExternalCourseJson with
    /// provider="Coursera". Optionally embed into the LanceDB corpus
    /// (--embed, grounds `udemy generate`) and/or upsert into data/courses.db
    /// for the frontend (--seed-frontend).
    Coursera {
        /// Articles index/listing URL to start the crawl from.
        #[arg(long, default_value = "https://www.coursera.org/articles")]
        seed_url: String,

        /// Stop after this many articles have been parsed.
        #[arg(long, default_value_t = 60)]
        max_articles: usize,

        /// Max concurrent article-page fetches.
        #[arg(long, default_value_t = 6)]
        concurrency: usize,

        /// Delay between fetch batches in milliseconds.
        #[arg(long, default_value_t = 800)]
        delay_ms: u64,

        /// Output JSON file (ExternalCourseJson[]).
        #[arg(long, default_value = "./data/coursera-articles.json")]
        output: PathBuf,

        /// Also embed + store articles (and their sections) in LanceDB.
        #[arg(long)]
        embed: bool,

        /// LanceDB path (only used with --embed).
        #[arg(long, default_value = "./lance-db")]
        db: String,

        /// Embed server URL (only used with --embed).
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,

        /// Batch size for embedding.
        #[arg(long, default_value_t = 8)]
        embed_batch: usize,

        /// Also upsert into data/courses.db (provider=Coursera) + link lessons.
        #[arg(long)]
        seed_frontend: bool,

        /// Dedicated SQLite course store (read by `export-content`).
        #[arg(long, default_value = "../../data/courses.db")]
        courses_db: PathBuf,
    },

    /// BFS-crawl DeepLearning.AI /courses/* pages from the short-courses
    /// catalog (+ seed slugs), relevance-filter them, and emit
    /// ExternalCourseJson with provider="DeepLearning.AI". Mapped across ALL
    /// topic rails (broad `match_slugs`, like the Coursera crawl). Optionally
    /// embed into the LanceDB corpus (--embed) and/or upsert into
    /// data/courses.db for the frontend (--seed-frontend).
    #[command(name = "deeplearning")]
    DeepLearning {
        /// Short-courses catalog URL to start the crawl from.
        #[arg(long, default_value = DEEPLEARNING_COURSES_INDEX)]
        seed_url: String,

        /// Stop after this many courses have been parsed.
        #[arg(long, default_value_t = 60)]
        max_courses: usize,

        /// Max concurrent course-page fetches.
        #[arg(long, default_value_t = 6)]
        concurrency: usize,

        /// Delay between fetch batches in milliseconds.
        #[arg(long, default_value_t = 800)]
        delay_ms: u64,

        /// Output JSON file (ExternalCourseJson[]).
        #[arg(long, default_value = "./data/deeplearning-courses.json")]
        output: PathBuf,

        /// Also embed + store courses (and their sections) in LanceDB.
        #[arg(long)]
        embed: bool,

        /// LanceDB path (only used with --embed).
        #[arg(long, default_value = "./lance-db")]
        db: String,

        /// Embed server URL (only used with --embed).
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,

        /// Batch size for embedding.
        #[arg(long, default_value_t = 8)]
        embed_batch: usize,

        /// Also upsert into data/courses.db (provider=DeepLearning.AI) + link.
        #[arg(long)]
        seed_frontend: bool,

        /// Dedicated SQLite course store (read by `export-content`).
        #[arg(long, default_value = "../../data/courses.db")]
        courses_db: PathBuf,

        /// Print the course→slug mapping table and exit (no writes).
        #[arg(long)]
        dry_run: bool,
    },

    /// Unified deep RAG/embeddings scrape across Coursera, DeepLearning.AI,
    /// and Udemy. Aggressively BFS-crawls Coursera + DeepLearning.AI with
    /// RAG-focused seeds (hard-filtered to RAG + adjacent LLM/agent lesson
    /// slugs), runs the Udemy RAG seed best-effort (Cloudflare may block),
    /// dedups by url across providers, upserts into data/courses.db, then
    /// regenerates the JSON exports. Respects each site's load via the shared
    /// per-batch delay + bounded concurrency; for personal/educational
    /// catalog indexing.
    #[command(name = "rag-deep-scrape")]
    RagDeepScrape {
        /// Stop after this many kept items per web provider.
        #[arg(long, default_value_t = 120)]
        max_per_provider: usize,

        /// Max concurrent page fetches (per provider crawl).
        #[arg(long, default_value_t = 6)]
        concurrency: usize,

        /// Delay between fetch batches in milliseconds.
        #[arg(long, default_value_t = 800)]
        delay_ms: u64,

        /// BFS frontier bound = max_per_provider × this.
        #[arg(long, default_value_t = 10)]
        frontier_multiplier: usize,

        /// Max Udemy candidates to scrape per RAG search query.
        #[arg(long, default_value_t = 20)]
        udemy_max: usize,

        /// Skip the flaky Udemy/Playwright path entirely.
        #[arg(long)]
        skip_udemy: bool,

        /// Dedicated SQLite course store (read by `export-content`).
        #[arg(long, default_value = "../../data/courses.db")]
        courses_db: PathBuf,

        /// Knowledge-app root — cwd base for the TS scraper + export-content.
        #[arg(long, default_value = "../..")]
        repo_root: PathBuf,

        /// Print the per-provider course→slug tables and exit (no writes).
        #[arg(long)]
        dry_run: bool,

        /// Skip the export-content step (leave data/content/*.json stale).
        #[arg(long)]
        no_export: bool,

        /// Extra explicit seed URL(s) to start the Coursera crawl from
        /// (repeatable). A `coursera.org/learn/<slug>` URL also becomes the
        /// crawl's index page so its recommendations rail is followed.
        #[arg(long = "seed")]
        seed: Vec<String>,
    },
}

#[derive(Subcommand)]
enum ChapterAction {
    /// Extract curriculum_sections from a udemy_courses*.json into the `chapters` table
    Ingest {
        /// Path to a udemy_courses*.json file
        json: PathBuf,
        #[arg(long, default_value = "./lance-db")]
        db: String,
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,
        #[arg(long, default_value_t = 64)]
        batch: usize,
    },
    /// Print one course's ordered chapter structure
    Of {
        /// course_id (slug)
        course_id: String,
        #[arg(long, default_value = "./lance-db")]
        db: String,
    },
    /// Semantic search over chapters across all courses
    Search {
        /// The search query
        query: String,
        #[arg(long, default_value = "./lance-db")]
        db: String,
        #[arg(long, short, default_value_t = 10)]
        top: usize,
        #[arg(long, default_value = "http://localhost:9999")]
        embed_url: String,
    },
}


#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Command::Crawl {
            output,
            topic_concurrency,
            course_concurrency,
            delay_ms,
            embed,
            db,
            embed_url,
            embed_batch,
        } => {
            cmd_crawl(
                output,
                topic_concurrency,
                course_concurrency,
                delay_ms,
                embed,
                db,
                embed_url,
                embed_batch,
            )
            .await
        }
        Command::Add {
            urls,
            output,
            db,
            embed_url,
            no_embed,
        } => cmd_add(urls, output, db, embed_url, no_embed).await,
        Command::Scrape {
            json,
            db,
            embed_url,
            batch,
        } => cmd_scrape(json, db, embed_url, batch).await,
        Command::Search {
            query,
            db,
            top,
            embed_url,
        } => cmd_search(query, db, top, embed_url).await,
        Command::RagSeed {
            max,
            courses_db,
            repo_root,
            dry_run,
        } => cmd_rag_seed(max, courses_db, repo_root, dry_run),
        Command::Coursera {
            seed_url,
            max_articles,
            concurrency,
            delay_ms,
            output,
            embed,
            db,
            embed_url,
            embed_batch,
            seed_frontend,
            courses_db,
        } => {
            cmd_coursera(
                seed_url,
                max_articles,
                concurrency,
                delay_ms,
                output,
                embed,
                db,
                embed_url,
                embed_batch,
                seed_frontend,
                courses_db,
            )
            .await
        }
        Command::DeepLearning {
            seed_url,
            max_courses,
            concurrency,
            delay_ms,
            output,
            embed,
            db,
            embed_url,
            embed_batch,
            seed_frontend,
            courses_db,
            dry_run,
        } => {
            cmd_deeplearning(
                seed_url,
                max_courses,
                concurrency,
                delay_ms,
                output,
                embed,
                db,
                embed_url,
                embed_batch,
                seed_frontend,
                courses_db,
                dry_run,
            )
            .await
        }
        Command::RagDeepScrape {
            max_per_provider,
            concurrency,
            delay_ms,
            frontier_multiplier,
            udemy_max,
            skip_udemy,
            courses_db,
            repo_root,
            dry_run,
            no_export,
            seed,
        } => {
            cmd_rag_deep_scrape(
                max_per_provider,
                concurrency,
                delay_ms,
                frontier_multiplier,
                udemy_max,
                skip_udemy,
                courses_db,
                repo_root,
                dry_run,
                no_export,
                seed,
            )
            .await
        }
        Command::Chapters { action } => match action {
            ChapterAction::Ingest {
                json,
                db,
                embed_url,
                batch,
            } => cmd_chapters_ingest(json, db, embed_url, batch).await,
            ChapterAction::Of { course_id, db } => cmd_chapters_of(course_id, db).await,
            ChapterAction::Search {
                query,
                db,
                top,
                embed_url,
            } => cmd_chapters_search(query, db, top, embed_url).await,
        },
        Command::Generate {
            slug,
            topic,
            category,
            related,
            db,
            embed_url,
            content_dir,
            model,
            top_courses,
            top_chapters,
            max_revisions,
            max_tokens,
            env_file,
            no_write,
        } => {
            cmd_generate(
                slug,
                topic,
                category,
                related,
                db,
                embed_url,
                content_dir,
                model,
                top_courses,
                top_chapters,
                max_revisions,
                max_tokens,
                env_file,
                no_write,
            )
            .await
        }
    }
}

// ── crawl ──────────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn cmd_crawl(
    output: PathBuf,
    topic_concurrency: usize,
    course_concurrency: usize,
    delay_ms: u64,
    embed: bool,
    db: String,
    embed_url: String,
    embed_batch_size: usize,
) -> Result<()> {
    let start = Instant::now();
    let mut stats = CrawlStats::default();
    let client = Arc::new(UdemyClient::new(&CrawlConfig::default())?);

    // ── Phase 1: BFS topic crawl ────────────────────────────────────────────
    eprintln!("Phase 1: Crawling topic pages...\n");

    let mut topic_queue: VecDeque<String> = SEED_TOPICS.iter().map(|s| s.to_string()).collect();
    let mut crawled_topics: HashSet<String> = HashSet::new();
    let mut discovered_urls: HashMap<String, String> = HashMap::new();

    let topic_sem = Arc::new(Semaphore::new(topic_concurrency));

    while !topic_queue.is_empty() {
        let mut batch = Vec::new();
        while batch.len() < topic_concurrency {
            match topic_queue.pop_front() {
                Some(t) if crawled_topics.insert(t.clone()) => batch.push(t),
                Some(_) => continue,
                None => break,
            }
        }
        if batch.is_empty() {
            break;
        }

        let mut handles = Vec::new();
        for topic in batch {
            let sem = Arc::clone(&topic_sem);
            let client = Arc::clone(&client);
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                let url = format!("https://www.udemy.com/topic/{topic}/");
                let result = client.fetch_page(&url).await;
                (topic, result)
            }));
        }

        for handle in handles {
            match handle.await {
                Ok((topic, FetchResult::Ok(html))) => {
                    let parsed = aer_ml::udemy::topic_parser::parse_topic_page(&html);
                    let n_courses = parsed.course_urls.len();
                    let n_topics = parsed.related_topics.len();
                    eprintln!("  /topic/{topic}/ — {n_courses} courses, {n_topics} related topics");
                    stats.topics_crawled += 1;

                    for url in parsed.course_urls {
                        discovered_urls.entry(url).or_insert_with(|| topic.clone());
                    }
                    for rt in parsed.related_topics {
                        if should_follow_topic(&rt) && !crawled_topics.contains(&rt) {
                            topic_queue.push_back(rt);
                        }
                    }
                }
                Ok((topic, FetchResult::CloudflareBlocked)) => {
                    eprintln!("  /topic/{topic}/ — BLOCKED (Cloudflare)");
                    stats.topics_blocked += 1;
                }
                Ok((topic, FetchResult::HttpError(code, _))) => {
                    warn!("/topic/{topic}/: HTTP {code}");
                    stats.topics_blocked += 1;
                }
                Ok((topic, FetchResult::ConnectionError(e))) => {
                    warn!("/topic/{topic}/: connection error: {e}");
                    stats.topics_blocked += 1;
                }
                Err(e) => {
                    warn!("topic task panicked: {e}");
                }
            }
        }

        if delay_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }
    }

    stats.courses_discovered = discovered_urls.len();
    eprintln!(
        "\nDiscovered {} courses from {} topics\n",
        stats.courses_discovered,
        stats.topics_crawled + stats.topics_blocked
    );

    if discovered_urls.is_empty() {
        eprintln!("No courses found — Cloudflare may be blocking topic pages.");
        stats.elapsed_secs = start.elapsed().as_secs_f64();
        eprintln!("\n{stats}");
        return Ok(());
    }

    // ── Phase 2: Parallel course fetch ──────────────────────────────────────
    eprintln!("Phase 2: Fetching course pages...\n");

    let course_sem = Arc::new(Semaphore::new(course_concurrency));
    let entries: Vec<(String, String)> = discovered_urls.into_iter().collect();
    let total = entries.len();
    let mut handles = Vec::new();

    for (url, from_topic) in entries {
        let sem = Arc::clone(&course_sem);
        let client = Arc::clone(&client);
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let result = client.fetch_page(&url).await;
            (url, from_topic, result)
        }));
    }

    let mut courses: Vec<ExternalCourseJson> = Vec::new();

    for (i, handle) in handles.into_iter().enumerate() {
        match handle.await {
            Ok((url, from_topic, FetchResult::Ok(html))) => {
                stats.courses_fetched += 1;

                match parse_course_html(&html, &url) {
                    Ok(course) => {
                        let full_text = course.embed_text();

                        if !is_relevant(&full_text) {
                            if (i + 1) % 50 == 0 || i + 1 == total {
                                eprintln!("  [{}/{}] progress...", i + 1, total);
                            }
                            stats.courses_irrelevant += 1;
                            continue;
                        }

                        let topic_group = classify_topic_group(&full_text);
                        let slug_mappings: Vec<SlugMapping> = match_slugs(&full_text)
                            .into_iter()
                            .map(|(slug, relevance)| SlugMapping { slug, relevance })
                            .collect();

                        let short = url
                            .replace("https://www.udemy.com/course/", "")
                            .replace('/', "");
                        eprintln!(
                            "  [{}/{}] [{topic_group}] {short} — {:.1}★",
                            i + 1,
                            total,
                            course.rating
                        );

                        let metadata = serde_json::json!({
                            "instructors": [course.instructor],
                            "whatYoullLearn": serde_json::from_str::<Vec<String>>(&course.topics_json).unwrap_or_default(),
                            "discoveredFrom": from_topic,
                        });

                        courses.push(ExternalCourseJson {
                            title: course.title,
                            url: course.url,
                            provider: "Udemy".to_string(),
                            description: if course.description.is_empty() {
                                None
                            } else {
                                Some(course.description)
                            },
                            level: if course.level.is_empty() {
                                None
                            } else {
                                Some(course.level)
                            },
                            rating: if course.rating > 0.0 {
                                Some(course.rating as f64)
                            } else {
                                None
                            },
                            review_count: if course.review_count > 0 {
                                Some(course.review_count)
                            } else {
                                None
                            },
                            duration_hours: if course.duration_hours > 0.0 {
                                Some(course.duration_hours as f64)
                            } else {
                                None
                            },
                            is_free: course.price.to_lowercase() == "free",
                            enrolled: if course.num_students > 0 {
                                Some(course.num_students)
                            } else {
                                None
                            },
                            image_url: if course.image_url.is_empty() {
                                None
                            } else {
                                Some(course.image_url)
                            },
                            language: course.language,
                            topic_group: topic_group.to_string(),
                            metadata,
                            slug_mappings,
                        });

                        stats.courses_saved += 1;
                    }
                    Err(e) => {
                        warn!("Parse error for {url}: {e}");
                        stats.courses_failed += 1;
                    }
                }
            }
            Ok((url, _, FetchResult::CloudflareBlocked)) => {
                let short = url
                    .replace("https://www.udemy.com/course/", "")
                    .replace('/', "");
                if stats.courses_blocked < 5 {
                    eprintln!("  [{}/{}] BLOCKED {short}", i + 1, total);
                } else if stats.courses_blocked == 5 {
                    eprintln!("  ... suppressing further block messages");
                }
                stats.courses_blocked += 1;
            }
            Ok((url, _, FetchResult::HttpError(code, _))) => {
                warn!("{url}: HTTP {code}");
                stats.courses_failed += 1;
            }
            Ok((url, _, FetchResult::ConnectionError(e))) => {
                warn!("{url}: {e}");
                stats.courses_failed += 1;
            }
            Err(e) => {
                warn!("course task panicked: {e}");
                stats.courses_failed += 1;
            }
        }
    }

    // ── Phase 3: Write JSON output ──────────────────────────────────────────
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(&courses).context("serializing courses")?;
    std::fs::write(&output, &json).with_context(|| format!("writing {}", output.display()))?;

    eprintln!("\nWrote {} courses to {}", courses.len(), output.display());

    // ── Phase 4 (optional): Embed + LanceDB ────────────────────────────────
    if embed && !courses.is_empty() {
        eprintln!("\nPhase 4: Embedding + LanceDB storage...\n");

        let http = reqwest::Client::new();
        http.get(format!("{}/health", embed_url))
            .send()
            .await
            .context("embed server not reachable — start with: cargo run -p candle --bin embed-server --features server")?;

        let store_courses: Vec<Course> = courses
            .iter()
            .map(|c| Course {
                course_id: c
                    .url
                    .trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or("unknown")
                    .to_string(),
                title: c.title.clone(),
                url: c.url.clone(),
                description: c.description.clone().unwrap_or_default(),
                instructor: c
                    .metadata
                    .get("instructors")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                level: c.level.clone().unwrap_or_default(),
                rating: c.rating.unwrap_or(0.0) as f32,
                review_count: c.review_count.unwrap_or(0),
                num_students: c.enrolled.unwrap_or(0),
                duration_hours: c.duration_hours.unwrap_or(0.0) as f32,
                price: if c.is_free {
                    "Free".to_string()
                } else {
                    String::new()
                },
                language: c.language.clone(),
                category: c.topic_group.clone(),
                image_url: c.image_url.clone().unwrap_or_default(),
                topics_json: c
                    .metadata
                    .get("whatYoullLearn")
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "[]".to_string()),
            })
            .collect();

        let mut store = CourseStore::connect(&db).await?;
        let mut done = 0usize;

        for chunk in store_courses.chunks(embed_batch_size) {
            let texts: Vec<String> = chunk.iter().map(|c| c.embed_text()).collect();
            let vecs = embed_batch(&http, &embed_url, &texts).await?;
            store.add(chunk, &vecs).await?;

            done += chunk.len();
            eprintln!("  {done}/{} embedded", store_courses.len());
        }

        eprintln!("Stored {done} course embeddings in {db}");
    }

    stats.elapsed_secs = start.elapsed().as_secs_f64();
    eprintln!("\n{}", "─".repeat(50));
    eprintln!("{stats}");

    Ok(())
}

// ── shared BFS crawl (Coursera / DeepLearning.AI) ───────────────────────────────

/// Articles a Coursera crawl kept (relevant), with everything needed to emit
/// JSON, embed into LanceDB, and upsert into courses.db.
struct KeptArticle {
    course: Course,
    chapters: Vec<Chapter>,
    topic_group: &'static str,
    slugs: Vec<(String, f32)>,
    discovered_from: String,
}

/// What differs between the Coursera and DeepLearning.AI BFS crawls: the
/// provider/source strings, log nouns, and the (identically-typed) index +
/// page parser functions. Everything else is shared in [`crawl_provider`].
struct ProviderSpec {
    provider: &'static str,
    source: &'static str,
    item_word: &'static str,
    index_word: &'static str,
    parse_index: fn(&str) -> Vec<String>,
    parse_page: fn(&str, &str) -> Result<(Course, Vec<Chapter>)>,
}

/// Runtime knobs for one provider crawl. `rag_only` restricts kept items to
/// the RAG-deep slug set (used by the unified orchestrator); standalone
/// `coursera`/`deeplearning` pass `false` for byte-identical behavior.
struct CrawlParams {
    seed_url: String,
    seed_paths: Vec<String>,
    max_items: usize,
    concurrency: usize,
    delay_ms: u64,
    frontier_multiplier: usize,
    rag_only: bool,
}

#[derive(Default)]
struct CrawlCounts {
    fetched: usize,
    irrelevant: usize,
    failed: usize,
    no_rag: usize,
    dup: usize,
}

/// Dual Coursera spec — discovers + parses BOTH `/articles/` and `/learn/`
/// pages. Used ONLY by the unified `rag-deep-scrape`.
fn coursera_spec() -> ProviderSpec {
    ProviderSpec {
        provider: "Coursera",
        source: "coursera-article",
        item_word: "page",
        index_word: "index",
        parse_index: parse_coursera_links,
        parse_page: parse_coursera_page,
    }
}

/// Article-only Coursera spec — used by the standalone `coursera` subcommand
/// so its crawl is provably byte-identical to the pre-Phase-2 behavior.
fn coursera_spec_articles_only() -> ProviderSpec {
    ProviderSpec {
        provider: "Coursera",
        source: "coursera-article",
        item_word: "article",
        index_word: "index",
        parse_index: parse_articles_index,
        parse_page: parse_article_html,
    }
}

fn deeplearning_spec() -> ProviderSpec {
    ProviderSpec {
        provider: "DeepLearning.AI",
        source: "deeplearning-short-course",
        item_word: "course",
        index_word: "catalog",
        parse_index: deeplearning::parse_courses_index,
        parse_page: deeplearning::parse_course_html,
    }
}

/// Generic BFS crawl shared by the Coursera and DeepLearning.AI paths. Seeds
/// `seed_paths` first (so a crawl works even if the index markup drifts), then
/// the index, then BFS-expands bounded by `max_items * frontier_multiplier`.
/// When `seen` is `Some`, kept URLs are deduped across providers in-run (the
/// `courses.db` UNIQUE(url) constraint is the durable backstop).
async fn crawl_provider(
    spec: &ProviderSpec,
    params: CrawlParams,
    client: Arc<UdemyClient>,
    seen: Option<Arc<Mutex<HashSet<String>>>>,
) -> Result<(Vec<KeptArticle>, CrawlCounts)> {
    let conc = params.concurrency.max(1);
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();

    for url in &params.seed_paths {
        if visited.insert(url.clone()) {
            queue.push_back(url.clone());
        }
    }

    eprintln!(
        "{}: fetching {} {} ...",
        spec.provider, spec.index_word, params.seed_url
    );
    match client.fetch_page(&params.seed_url).await {
        FetchResult::Ok(html) => {
            let found = (spec.parse_index)(&html);
            eprintln!(
                "  {} → {} {} link(s)",
                spec.index_word,
                found.len(),
                spec.item_word
            );
            for u in found {
                if visited.insert(u.clone()) {
                    queue.push_back(u);
                }
            }
        }
        other => {
            let label = match &other {
                FetchResult::CloudflareBlocked => "cloudflare".to_string(),
                FetchResult::HttpError(c, _) => format!("http {c}"),
                FetchResult::ConnectionError(e) => format!("conn: {e}"),
                FetchResult::Ok(_) => unreachable!(),
            };
            eprintln!(
                "  {} fetch failed ({label}); continuing with {} seed slug(s)",
                spec.index_word,
                queue.len()
            );
        }
    }

    let mut kept: Vec<KeptArticle> = Vec::new();
    let mut counts = CrawlCounts::default();
    let sem = Arc::new(Semaphore::new(conc));

    'outer: while !queue.is_empty() {
        let mut batch = Vec::new();
        while batch.len() < conc {
            match queue.pop_front() {
                Some(u) => batch.push(u),
                None => break,
            }
        }
        if batch.is_empty() {
            break;
        }

        let mut handles = Vec::new();
        for url in batch {
            let sem = Arc::clone(&sem);
            let client = Arc::clone(&client);
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                let r = client.fetch_page(&url).await;
                (url, r)
            }));
        }

        for handle in handles {
            let (url, result) = match handle.await {
                Ok(t) => t,
                Err(e) => {
                    warn!("{} task panicked: {e}", spec.provider);
                    counts.failed += 1;
                    continue;
                }
            };
            match result {
                FetchResult::Ok(html) => {
                    counts.fetched += 1;
                    // BFS: enqueue related links, bounded so a deep crawl
                    // can't blow up the frontier.
                    if visited.len() < params.max_items.saturating_mul(params.frontier_multiplier)
                    {
                        for u in (spec.parse_index)(&html) {
                            if visited.insert(u.clone()) {
                                queue.push_back(u);
                            }
                        }
                    }
                    match (spec.parse_page)(&html, &url) {
                        Ok((course, chapters)) => {
                            let text = course.embed_text();
                            if !is_relevant(&text) {
                                counts.irrelevant += 1;
                                continue;
                            }
                            let topic_group = classify_topic_group(&text);
                            let slugs: Vec<(String, f32)> = if params.rag_only {
                                match_slugs(&text)
                                    .into_iter()
                                    .filter(|(s, _)| is_rag_deep_slug(s))
                                    .collect()
                            } else {
                                match_slugs(&text)
                            };
                            if params.rag_only && slugs.is_empty() {
                                counts.no_rag += 1;
                                continue;
                            }
                            // Cross-provider in-run dedup.
                            if let Some(seen) = &seen {
                                if !seen.lock().unwrap().insert(course.url.clone()) {
                                    counts.dup += 1;
                                    continue;
                                }
                            }
                            eprintln!(
                                "  ✓ [{topic_group}] {} ({} sections)",
                                course.title,
                                chapters.len()
                            );
                            kept.push(KeptArticle {
                                course,
                                chapters,
                                topic_group,
                                slugs,
                                discovered_from: params.seed_url.clone(),
                            });
                            if kept.len() >= params.max_items {
                                eprintln!(
                                    "  reached max {} {}(s)",
                                    params.max_items, spec.item_word
                                );
                                break 'outer;
                            }
                        }
                        Err(e) => {
                            warn!("parse error for {url}: {e}");
                            counts.failed += 1;
                        }
                    }
                }
                FetchResult::CloudflareBlocked => {
                    warn!("{url}: Cloudflare blocked");
                    counts.failed += 1;
                }
                FetchResult::HttpError(code, _) => {
                    warn!("{url}: HTTP {code}");
                    counts.failed += 1;
                }
                FetchResult::ConnectionError(e) => {
                    warn!("{url}: {e}");
                    counts.failed += 1;
                }
            }
        }

        if params.delay_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(params.delay_ms)).await;
        }
    }

    Ok((kept, counts))
}

// ── coursera ───────────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn cmd_coursera(
    seed_url: String,
    max_articles: usize,
    concurrency: usize,
    delay_ms: u64,
    output: PathBuf,
    embed: bool,
    db: String,
    embed_url: String,
    embed_batch_size: usize,
    seed_frontend: bool,
    courses_db: PathBuf,
) -> Result<()> {
    let start = Instant::now();
    let client = Arc::new(UdemyClient::new(&CrawlConfig::default())?);
    let spec = coursera_spec_articles_only();
    let params = CrawlParams {
        seed_url: seed_url.clone(),
        seed_paths: COURSERA_SEED_ARTICLES
            .iter()
            .map(|s| format!("https://www.coursera.org/articles/{s}"))
            .collect(),
        max_items: max_articles,
        concurrency,
        delay_ms,
        frontier_multiplier: 6,
        rag_only: false,
    };
    let (kept, counts) = crawl_provider(&spec, params, client, None).await?;
    let (n_fetched, n_irrelevant, n_failed) =
        (counts.fetched, counts.irrelevant, counts.failed);

    // ── Emit ExternalCourseJson ─────────────────────────────────────────
    let ext: Vec<ExternalCourseJson> = kept
        .iter()
        .map(|k| {
            let c = &k.course;
            let sections: Vec<String> =
                serde_json::from_str(&c.topics_json).unwrap_or_default();
            ExternalCourseJson {
                title: c.title.clone(),
                url: c.url.clone(),
                provider: "Coursera".to_string(),
                description: if c.description.is_empty() {
                    None
                } else {
                    Some(c.description.clone())
                },
                level: None,
                rating: None,
                review_count: None,
                duration_hours: None,
                is_free: true,
                enrolled: None,
                image_url: if c.image_url.is_empty() {
                    None
                } else {
                    Some(c.image_url.clone())
                },
                language: c.language.clone(),
                topic_group: k.topic_group.to_string(),
                metadata: serde_json::json!({
                    "author": c.instructor,
                    "sections": sections,
                    "source": "coursera-article",
                    "discoveredFrom": k.discovered_from,
                }),
                slug_mappings: k
                    .slugs
                    .iter()
                    .cloned()
                    .map(|(slug, relevance)| SlugMapping { slug, relevance })
                    .collect(),
            }
        })
        .collect();

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&output, serde_json::to_string_pretty(&ext)?)
        .with_context(|| format!("writing {}", output.display()))?;
    eprintln!(
        "\nWrote {} Coursera article(s) to {}",
        ext.len(),
        output.display()
    );

    // ── Optional: embed articles + sections into the LanceDB corpus ─────
    if embed && !kept.is_empty() {
        eprintln!("\nEmbedding into LanceDB ({db}) ...");
        let http = reqwest::Client::new();
        http.get(format!("{embed_url}/health"))
            .send()
            .await
            .context("embed server not reachable — start with: cargo run -p candle --bin embed-server --features server")?;

        let mut store = CourseStore::connect(&db).await?;
        let existing = store.existing_ids().await?;

        let new_courses: Vec<Course> = kept
            .iter()
            .map(|k| k.course.clone())
            .filter(|c| !existing.contains(&c.course_id))
            .collect();

        if new_courses.is_empty() {
            eprintln!("  all articles already in store");
        } else {
            let mut done = 0usize;
            for chunk in new_courses.chunks(embed_batch_size.max(1)) {
                let texts: Vec<String> = chunk.iter().map(|c| c.embed_text()).collect();
                let vecs = embed_batch(&http, &embed_url, &texts).await?;
                store.add(chunk, &vecs).await?;
                done += chunk.len();
                eprintln!("  {done}/{} articles embedded", new_courses.len());
            }

            let new_ids: HashSet<&str> =
                new_courses.iter().map(|c| c.course_id.as_str()).collect();
            let chapters: Vec<Chapter> = kept
                .iter()
                .filter(|k| new_ids.contains(k.course.course_id.as_str()))
                .flat_map(|k| k.chapters.clone())
                .collect();
            if !chapters.is_empty() {
                let mut cdone = 0usize;
                for chunk in chapters.chunks(embed_batch_size.max(1)) {
                    let texts: Vec<String> =
                        chunk.iter().map(|c| c.embed_text()).collect();
                    let vecs = embed_batch(&http, &embed_url, &texts).await?;
                    store.add_chapters(chunk, &vecs).await?;
                    cdone += chunk.len();
                    eprintln!("  {cdone}/{} sections embedded", chapters.len());
                }
            }
        }
    }

    // ── Optional: upsert into data/courses.db for the frontend ──────────
    if seed_frontend && !kept.is_empty() {
        eprintln!("\nUpserting into {} ...", courses_db.display());
        let conn = courses::open(&courses_db)
            .with_context(|| format!("opening {}", courses_db.display()))?;
        let (mut n_up, mut n_links) = (0usize, 0usize);
        for k in &kept {
            let c = &k.course;
            let sections: Vec<String> =
                serde_json::from_str(&c.topics_json).unwrap_or_default();
            let value = serde_json::json!({
                "title": c.title,
                "url": c.url,
                "description": c.description,
                "isFree": true,
                "imageUrl": c.image_url,
                "language": c.language,
                "metadata": {
                    "author": c.instructor,
                    "sections": sections,
                    "source": "coursera-article",
                },
            });
            let id = match courses::upsert_course(&conn, &value, "Coursera", k.topic_group) {
                Ok(id) => id,
                Err(e) => {
                    eprintln!("  upsert failed: {e:#}");
                    continue;
                }
            };
            n_up += 1;
            for (slug, rel) in &k.slugs {
                courses::link_lesson_course(&conn, slug, &id, *rel as f64)?;
                n_links += 1;
            }
        }
        eprintln!(
            "Upserted {n_up} article(s), {n_links} lesson link(s) → {}",
            courses_db.display()
        );
    }

    eprintln!(
        "\n{}\nCoursera: fetched {n_fetched} · kept {} · irrelevant {n_irrelevant} · failed {n_failed} · {:.1}s",
        "─".repeat(50),
        kept.len(),
        start.elapsed().as_secs_f64()
    );
    Ok(())
}

// ── deeplearning ────────────────────────────────────────────────────────────────

/// BFS-crawl DeepLearning.AI short courses (mirrors [`cmd_coursera`], with a
/// __NEXT_DATA__/JSON-LD `Course` parser, provider="DeepLearning.AI", and
/// broad `match_slugs` so a course can land on any matching lesson rail).
#[allow(clippy::too_many_arguments)]
async fn cmd_deeplearning(
    seed_url: String,
    max_courses: usize,
    concurrency: usize,
    delay_ms: u64,
    output: PathBuf,
    embed: bool,
    db: String,
    embed_url: String,
    embed_batch_size: usize,
    seed_frontend: bool,
    courses_db: PathBuf,
    dry_run: bool,
) -> Result<()> {
    let start = Instant::now();
    let client = Arc::new(UdemyClient::new(&CrawlConfig::default())?);
    let spec = deeplearning_spec();
    let params = CrawlParams {
        seed_url: seed_url.clone(),
        seed_paths: DEEPLEARNING_SEED_COURSES
            .iter()
            .map(|s| format!("https://www.deeplearning.ai/courses/{s}/"))
            .collect(),
        max_items: max_courses,
        concurrency,
        delay_ms,
        frontier_multiplier: 6,
        rag_only: false,
    };
    let (kept, counts) = crawl_provider(&spec, params, client, None).await?;
    let (n_fetched, n_irrelevant, n_failed) =
        (counts.fetched, counts.irrelevant, counts.failed);

    // ── Dry run: print the course→slug mapping table and exit ───────────
    if dry_run {
        for k in &kept {
            let pretty: Vec<String> = k
                .slugs
                .iter()
                .map(|(s, r)| format!("{s}={r:.2}"))
                .collect();
            println!("• [{}] {}\n    {}", k.topic_group, k.course.title, pretty.join("  "));
        }
        eprintln!(
            "\nDeepLearning.AI (dry-run): fetched {n_fetched} · kept {} · irrelevant {n_irrelevant} · failed {n_failed} · nothing written",
            kept.len()
        );
        return Ok(());
    }

    // ── Emit ExternalCourseJson ─────────────────────────────────────────
    let ext: Vec<ExternalCourseJson> = kept
        .iter()
        .map(|k| {
            let c = &k.course;
            let sections: Vec<String> =
                serde_json::from_str(&c.topics_json).unwrap_or_default();
            ExternalCourseJson {
                title: c.title.clone(),
                url: c.url.clone(),
                provider: "DeepLearning.AI".to_string(),
                description: if c.description.is_empty() {
                    None
                } else {
                    Some(c.description.clone())
                },
                level: if c.level.is_empty() || c.level == "All Levels" {
                    None
                } else {
                    Some(c.level.clone())
                },
                rating: None,
                review_count: None,
                duration_hours: if c.duration_hours > 0.0 {
                    Some(c.duration_hours as f64)
                } else {
                    None
                },
                is_free: true,
                enrolled: None,
                image_url: if c.image_url.is_empty() {
                    None
                } else {
                    Some(c.image_url.clone())
                },
                language: c.language.clone(),
                topic_group: k.topic_group.to_string(),
                metadata: serde_json::json!({
                    "author": c.instructor,
                    "sections": sections,
                    "source": "deeplearning-short-course",
                    "discoveredFrom": k.discovered_from,
                }),
                slug_mappings: k
                    .slugs
                    .iter()
                    .cloned()
                    .map(|(slug, relevance)| SlugMapping { slug, relevance })
                    .collect(),
            }
        })
        .collect();

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&output, serde_json::to_string_pretty(&ext)?)
        .with_context(|| format!("writing {}", output.display()))?;
    eprintln!(
        "\nWrote {} DeepLearning.AI course(s) to {}",
        ext.len(),
        output.display()
    );

    // ── Optional: embed courses + sections into the LanceDB corpus ──────
    if embed && !kept.is_empty() {
        eprintln!("\nEmbedding into LanceDB ({db}) ...");
        let http = reqwest::Client::new();
        http.get(format!("{embed_url}/health"))
            .send()
            .await
            .context("embed server not reachable — start with: cargo run -p candle --bin embed-server --features server")?;

        let mut store = CourseStore::connect(&db).await?;
        let existing = store.existing_ids().await?;

        let new_courses: Vec<Course> = kept
            .iter()
            .map(|k| k.course.clone())
            .filter(|c| !existing.contains(&c.course_id))
            .collect();

        if new_courses.is_empty() {
            eprintln!("  all courses already in store");
        } else {
            let mut done = 0usize;
            for chunk in new_courses.chunks(embed_batch_size.max(1)) {
                let texts: Vec<String> = chunk.iter().map(|c| c.embed_text()).collect();
                let vecs = embed_batch(&http, &embed_url, &texts).await?;
                store.add(chunk, &vecs).await?;
                done += chunk.len();
                eprintln!("  {done}/{} courses embedded", new_courses.len());
            }

            let new_ids: HashSet<&str> =
                new_courses.iter().map(|c| c.course_id.as_str()).collect();
            let chapters: Vec<Chapter> = kept
                .iter()
                .filter(|k| new_ids.contains(k.course.course_id.as_str()))
                .flat_map(|k| k.chapters.clone())
                .collect();
            if !chapters.is_empty() {
                let mut cdone = 0usize;
                for chunk in chapters.chunks(embed_batch_size.max(1)) {
                    let texts: Vec<String> =
                        chunk.iter().map(|c| c.embed_text()).collect();
                    let vecs = embed_batch(&http, &embed_url, &texts).await?;
                    store.add_chapters(chunk, &vecs).await?;
                    cdone += chunk.len();
                    eprintln!("  {cdone}/{} sections embedded", chapters.len());
                }
            }
        }
    }

    // ── Optional: upsert into data/courses.db for the frontend ──────────
    if seed_frontend && !kept.is_empty() {
        eprintln!("\nUpserting into {} ...", courses_db.display());
        let conn = courses::open(&courses_db)
            .with_context(|| format!("opening {}", courses_db.display()))?;
        let (mut n_up, mut n_links) = (0usize, 0usize);
        for k in &kept {
            let c = &k.course;
            let sections: Vec<String> =
                serde_json::from_str(&c.topics_json).unwrap_or_default();
            let value = serde_json::json!({
                "title": c.title,
                "url": c.url,
                "description": c.description,
                "level": c.level,
                "durationHours": c.duration_hours as f64,
                "isFree": true,
                "imageUrl": c.image_url,
                "language": c.language,
                "metadata": {
                    "author": c.instructor,
                    "sections": sections,
                    "source": "deeplearning-short-course",
                },
            });
            let id = match courses::upsert_course(
                &conn,
                &value,
                "DeepLearning.AI",
                k.topic_group,
            ) {
                Ok(id) => id,
                Err(e) => {
                    eprintln!("  upsert failed: {e:#}");
                    continue;
                }
            };
            n_up += 1;
            for (slug, rel) in &k.slugs {
                courses::link_lesson_course(&conn, slug, &id, *rel as f64)?;
                n_links += 1;
            }
        }
        eprintln!(
            "Upserted {n_up} course(s), {n_links} lesson link(s) → {}",
            courses_db.display()
        );
    }

    eprintln!(
        "\n{}\nDeepLearning.AI: fetched {n_fetched} · kept {} · irrelevant {n_irrelevant} · failed {n_failed} · {:.1}s",
        "─".repeat(50),
        kept.len(),
        start.elapsed().as_secs_f64()
    );
    Ok(())
}

// ── add ───────────────────────────────────────────────────────────────────────

/// Normalise a user-supplied Udemy URL to `https://www.udemy.com/course/<slug>/`.
fn normalise_course_url(raw: &str) -> String {
    // Strip /learn/lecture/... or any query/fragment
    let base = raw
        .split("/learn/")
        .next()
        .unwrap_or(raw)
        .split('?')
        .next()
        .unwrap_or(raw)
        .split('#')
        .next()
        .unwrap_or(raw);

    let slug = base
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("unknown");

    format!("https://www.udemy.com/course/{slug}/")
}

/// Udemy public API response for a course.
#[derive(Deserialize)]
struct ApiCourse {
    title: String,
    #[serde(default)]
    headline: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    num_subscribers: Option<u32>,
    #[serde(default)]
    avg_rating: Option<f64>,
    #[serde(default)]
    num_reviews: Option<u32>,
    #[serde(default)]
    image_480x270: Option<String>,
    #[serde(default)]
    instructional_level: Option<String>,
    #[serde(default)]
    content_info: Option<String>,
    #[serde(default)]
    is_paid: Option<bool>,
    #[serde(default)]
    price: Option<String>,
    #[serde(default)]
    visible_instructors: Vec<ApiInstructor>,
    locale: Option<ApiLocale>,
}

#[derive(Deserialize)]
struct ApiInstructor {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Deserialize)]
struct ApiLocale {
    #[serde(default)]
    simple_english_title: Option<String>,
}

/// Fetch course metadata via the Udemy public API (no auth required).
async fn fetch_via_api(http: &reqwest::Client, slug: &str) -> Result<Course> {
    let api_url = format!(
        "https://www.udemy.com/api-2.0/courses/{slug}/?fields%5Bcourse%5D=\
         title,headline,description,num_subscribers,avg_rating,num_reviews,\
         image_480x270,instructional_level,content_info,visible_instructors,\
         is_paid,price,locale"
    );

    let api: ApiCourse = http
        .get(&api_url)
        .send()
        .await
        .context("Udemy API request failed")?
        .json()
        .await
        .context("parsing Udemy API response")?;

    // Parse duration from content_info like "2.5 total hours"
    let duration_hours = api
        .content_info
        .as_deref()
        .and_then(|s| {
            let lower = s.to_lowercase();
            lower
                .split_whitespace()
                .next()
                .and_then(|n| n.parse::<f32>().ok())
        })
        .unwrap_or(0.0);

    let instructor = api
        .visible_instructors
        .first()
        .and_then(|i| i.display_name.as_deref().or(i.title.as_deref()))
        .unwrap_or("")
        .to_string();

    // Strip HTML from description
    let description = api
        .description
        .or(api.headline.clone())
        .map(|d| strip_html_tags(&d))
        .unwrap_or_default();

    let price = if api.is_paid == Some(false) {
        "Free".to_string()
    } else {
        api.price.unwrap_or_default()
    };

    Ok(Course {
        course_id: slug.to_string(),
        title: api.title,
        url: format!("https://www.udemy.com/course/{slug}/"),
        description,
        instructor,
        level: api
            .instructional_level
            .unwrap_or_else(|| "All Levels".to_string()),
        rating: api.avg_rating.unwrap_or(0.0) as f32,
        review_count: api.num_reviews.unwrap_or(0),
        num_students: api.num_subscribers.unwrap_or(0),
        duration_hours,
        price,
        language: api
            .locale
            .and_then(|l| l.simple_english_title)
            .unwrap_or_else(|| "English".to_string()),
        category: String::new(),
        image_url: api.image_480x270.unwrap_or_default(),
        topics_json: "[]".to_string(),
    })
}

/// Minimal HTML tag stripping.
fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    // Collapse whitespace
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn cmd_add(
    urls: Vec<String>,
    output: Option<PathBuf>,
    db: String,
    embed_url: String,
    no_embed: bool,
) -> Result<()> {
    if urls.is_empty() {
        anyhow::bail!("provide at least one course URL");
    }

    let crawler = UdemyClient::new(&CrawlConfig::default())?;
    let http = reqwest::Client::new();
    let mut courses: Vec<Course> = Vec::new();
    let mut ext_courses: Vec<ExternalCourseJson> = Vec::new();

    for raw_url in &urls {
        let url = normalise_course_url(raw_url);
        let slug = url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("unknown");

        eprintln!("Fetching {url} ...");

        // Try HTML scrape first, fall back to Udemy API
        let course = match crawler.fetch_page(&url).await {
            FetchResult::Ok(html) => match parse_course_html(&html, &url) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("  parse error ({e}), falling back to API...");
                    fetch_via_api(&http, slug).await?
                }
            },
            _ => {
                eprintln!("  Cloudflare blocked, using Udemy API...");
                fetch_via_api(&http, slug).await?
            }
        };

        let full_text = course.embed_text();
        let topic_group = classify_topic_group(&full_text);
        let slug_mappings: Vec<SlugMapping> = match_slugs(&full_text)
            .into_iter()
            .map(|(slug, relevance)| SlugMapping { slug, relevance })
            .collect();

        eprintln!(
            "  ✓ {} — {:.1}★ ({} reviews) [{}]",
            course.title, course.rating, course.review_count, topic_group
        );

        let metadata = serde_json::json!({
            "instructors": [course.instructor],
            "whatYoullLearn": serde_json::from_str::<Vec<String>>(&course.topics_json).unwrap_or_default(),
        });

        ext_courses.push(ExternalCourseJson {
            title: course.title.clone(),
            url: course.url.clone(),
            provider: "Udemy".to_string(),
            description: if course.description.is_empty() {
                None
            } else {
                Some(course.description.clone())
            },
            level: if course.level.is_empty() {
                None
            } else {
                Some(course.level.clone())
            },
            rating: if course.rating > 0.0 {
                Some(course.rating as f64)
            } else {
                None
            },
            review_count: if course.review_count > 0 {
                Some(course.review_count)
            } else {
                None
            },
            duration_hours: if course.duration_hours > 0.0 {
                Some(course.duration_hours as f64)
            } else {
                None
            },
            is_free: course.price.to_lowercase() == "free",
            enrolled: if course.num_students > 0 {
                Some(course.num_students)
            } else {
                None
            },
            image_url: if course.image_url.is_empty() {
                None
            } else {
                Some(course.image_url.clone())
            },
            language: course.language.clone(),
            topic_group: topic_group.to_string(),
            metadata,
            slug_mappings,
        });

        courses.push(course);
    }

    if courses.is_empty() {
        eprintln!("\nNo courses fetched successfully.");
        return Ok(());
    }

    // Write JSON if requested
    if let Some(path) = &output {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let json = serde_json::to_string_pretty(&ext_courses)?;
        std::fs::write(path, &json)?;
        eprintln!(
            "\nWrote {} course(s) to {}",
            ext_courses.len(),
            path.display()
        );
    }

    // Embed + store
    if !no_embed {
        let http = reqwest::Client::new();
        http.get(format!("{embed_url}/health"))
            .send()
            .await
            .context("embed server not reachable — start with: cargo run -p candle --bin embed-server --features server")?;

        let mut store = CourseStore::connect(&db).await?;
        let existing = store.existing_ids().await?;

        let mut new_courses = Vec::new();
        let mut new_texts = Vec::new();
        for c in &courses {
            if existing.contains(&c.course_id) {
                eprintln!("  skip {} (already in store)", c.course_id);
            } else {
                new_texts.push(c.embed_text());
                new_courses.push(c.clone());
            }
        }

        if new_courses.is_empty() {
            eprintln!("\nAll courses already in store.");
        } else {
            let vecs = embed_batch(&http, &embed_url, &new_texts).await?;
            store.add(&new_courses, &vecs).await?;
            eprintln!("\nStored {} course(s) in {db}", new_courses.len());
        }
    }

    Ok(())
}

// ── scrape ─────────────────────────────────────────────────────────────────────

async fn cmd_scrape(json: PathBuf, db: String, embed_url: String, batch: usize) -> Result<()> {
    let courses: Vec<Course> = load_courses_json(&json)?;
    if courses.is_empty() {
        eprintln!("No courses found in {}", json.display());
        return Ok(());
    }
    eprintln!("Loaded {} courses from {}", courses.len(), json.display());

    let client = reqwest::Client::new();
    client
        .get(format!("{}/health", embed_url))
        .send()
        .await
        .context("embed server not reachable — start it with: cargo run -p candle --bin embed-server --features server")?;
    eprintln!("Embed server OK at {embed_url}");

    let mut store = CourseStore::connect(&db).await?;
    let already = store.count().await?;
    info!("{already} courses already in store");

    let total = courses.len();
    let mut done = 0usize;

    for chunk in courses.chunks(batch) {
        let texts: Vec<String> = chunk.iter().map(|c| c.embed_text()).collect();
        let vecs = embed_batch(&client, &embed_url, &texts).await?;
        store.add(chunk, &vecs).await?;

        done += chunk.len();
        eprintln!("  {done}/{total} embedded");
    }

    eprintln!(
        "\nDone — {done} courses indexed into {db} ({} total rows)",
        already + done
    );
    Ok(())
}

// ── search ─────────────────────────────────────────────────────────────────────

async fn cmd_search(query: String, db: String, top: usize, embed_url: String) -> Result<()> {
    let client = reqwest::Client::new();
    let vec = embed_one(&client, &embed_url, &query).await?;

    let store = CourseStore::connect(&db).await?;
    let results = store.search(vec, top).await?;

    if results.is_empty() {
        eprintln!("No results — is the store populated? Run `udemy scrape` first.");
        return Ok(());
    }

    println!("\nQuery: \"{query}\"\n");
    println!("Rank Score  Title                                         Rating Instructor");
    println!("{}", "-".repeat(90));

    for (i, r) in results.iter().enumerate() {
        let c = &r.course;
        println!(
            "{:<4} {:<6.3} {:<45} {:<6.1} {}",
            i + 1,
            r.score,
            truncate(&c.title, 44),
            c.rating,
            truncate(&c.instructor, 25),
        );
        println!("     {} | {} | {}", c.level, c.price, c.url);
        println!("     {}", truncate(&c.description, 85));
        println!();
    }

    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max.saturating_sub(1)])
    }
}


// ── rag-seed ───────────────────────────────────────────────────────────────────

/// Run `scripts/fetch-udemy-search.ts` (Playwright, Cloudflare-bypassing) for
/// one search URL and return its `courses` array. Mirrors the proven
/// subprocess pattern in `knowledge-ml-server`'s `seed-topic-courses` bin.
fn run_ts_scraper(
    repo_root: &std::path::Path,
    search_url: &str,
    max: usize,
) -> Result<Vec<serde_json::Value>> {
    eprintln!(
        "  $ pnpm tsx scripts/fetch-udemy-search.ts \"{search_url}\" --max {max}  (cwd={})",
        repo_root.display()
    );
    let out = std::process::Command::new("pnpm")
        .args([
            "tsx",
            "scripts/fetch-udemy-search.ts",
            search_url,
            "--max",
            &max.to_string(),
        ])
        .current_dir(repo_root)
        .output()
        .context("spawning fetch-udemy-search.ts (is pnpm on PATH?)")?;

    if !out.stderr.is_empty() {
        eprint!("{}", String::from_utf8_lossy(&out.stderr));
    }
    if !out.status.success() {
        anyhow::bail!(
            "fetch-udemy-search.ts exited {}; see stderr above.",
            out.status.code().unwrap_or(-1)
        );
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let last = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .next_back()
        .ok_or_else(|| anyhow::anyhow!("scraper returned no stdout"))?;
    let payload: serde_json::Value =
        serde_json::from_str(last).context("scraper stdout was not JSON")?;
    Ok(payload
        .get("courses")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default())
}

/// Title + description + subtitle + "what you'll learn" — the text the
/// keyword relevance/slug-mapping logic scores against.
fn course_text(c: &serde_json::Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(t) = c.get("title").and_then(|v| v.as_str()) {
        parts.push(t.to_string());
    }
    if let Some(d) = c.get("description").and_then(|v| v.as_str()) {
        parts.push(d.to_string());
    }
    if let Some(meta) = c.get("metadata") {
        if let Some(s) = meta.get("subtitle").and_then(|v| v.as_str()) {
            parts.push(s.to_string());
        }
        if let Some(arr) = meta.get("whatYoullLearn").and_then(|v| v.as_array()) {
            for it in arr.iter().filter_map(|v| v.as_str()) {
                parts.push(it.to_string());
            }
        }
    }
    parts.join(" \n ")
}

/// Phase 1+2 of the Udemy RAG seed, shared by `cmd_rag_seed` and the unified
/// `cmd_rag_deep_scrape`: scrape every [`RAG_SEED_QUERIES`] via the Playwright
/// subprocess, dedupe by url, relevance-filter, and slug-map against the
/// RAG-deep slug set. When `seen` is `Some`, urls are deduped across providers
/// in-run. Returns `(kept, n_irrelevant, n_no_rag)`.
fn rag_seed_collect(
    repo_root: &std::path::Path,
    max: usize,
    seen: Option<&Arc<Mutex<HashSet<String>>>>,
) -> Result<(Vec<(serde_json::Value, Vec<(String, f32)>)>, usize, usize)> {
    // Phase 1: scrape every RAG query, dedupe by url.
    let mut by_url: HashMap<String, serde_json::Value> = HashMap::new();
    for (i, q) in RAG_SEED_QUERIES.iter().enumerate() {
        let encoded = q.replace(' ', "+");
        let search_url =
            format!("https://www.udemy.com/courses/search/?q={encoded}&sort=most-reviewed");
        eprintln!("[{}/{}] query: \"{q}\"", i + 1, RAG_SEED_QUERIES.len());
        match run_ts_scraper(repo_root, &search_url, max) {
            Ok(scraped) => {
                let mut added = 0usize;
                for c in scraped {
                    if let Some(u) = c.get("url").and_then(|v| v.as_str()) {
                        // Cross-provider in-run dedup when sharing a set.
                        if let Some(seen) = seen {
                            if !seen.lock().unwrap().insert(u.to_string()) {
                                continue;
                            }
                        }
                        if by_url.insert(u.to_string(), c).is_none() {
                            added += 1;
                        }
                    }
                }
                eprintln!("  +{added} new (unique total {})", by_url.len());
            }
            Err(e) => eprintln!("  scrape failed for \"{q}\": {e:#}"),
        }
    }

    if by_url.is_empty() {
        anyhow::bail!("no courses scraped — Playwright/Cloudflare blocked or pnpm missing");
    }

    // Phase 2: relevance-filter + slug-map (RAG-deep slugs only).
    let mut kept: Vec<(serde_json::Value, Vec<(String, f32)>)> = Vec::new();
    let (mut n_irrelevant, mut n_no_rag) = (0usize, 0usize);
    for c in by_url.into_values() {
        let text = course_text(&c);
        if !is_relevant(&text) {
            n_irrelevant += 1;
            continue;
        }
        let mappings: Vec<(String, f32)> = match_slugs(&text)
            .into_iter()
            .filter(|(slug, _)| is_rag_deep_slug(slug))
            .collect();
        if mappings.is_empty() {
            n_no_rag += 1;
            continue;
        }
        kept.push((c, mappings));
    }

    Ok((kept, n_irrelevant, n_no_rag))
}

/// Scrape every RAG query, relevance-filter + slug-map against the RAG-deep
/// slug set, then upsert into `data/courses.db` (or print a table with
/// `--dry-run`).
fn cmd_rag_seed(
    max: usize,
    courses_db: PathBuf,
    repo_root: PathBuf,
    dry_run: bool,
) -> Result<()> {
    eprintln!(
        "RAG seed: {} queries × max {max} candidates → RAG-deep lessons\n",
        RAG_SEED_QUERIES.len()
    );

    let (kept, n_irrelevant, n_no_rag) = rag_seed_collect(&repo_root, max, None)?;

    eprintln!(
        "\nScraped {} unique · kept {} RAG ({} irrelevant, {} no RAG-deep slug)\n",
        kept.len() + n_irrelevant + n_no_rag,
        kept.len(),
        n_irrelevant,
        n_no_rag
    );

    if dry_run {
        for (c, mappings) in &kept {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("?");
            let pretty: Vec<String> = mappings
                .iter()
                .map(|(s, r)| format!("{s}={r:.2}"))
                .collect();
            println!("• {title}\n    {}", pretty.join("  "));
        }
        eprintln!("\n(dry-run: nothing written to {})", courses_db.display());
        return Ok(());
    }

    // Phase 3: persist via the shared `courses` writer (data/courses.db).
    let conn = courses::open(&courses_db)
        .with_context(|| format!("opening {}", courses_db.display()))?;
    let (mut n_courses, mut n_links) = (0usize, 0usize);
    for (c, mappings) in &kept {
        let id = match courses::upsert_course(&conn, c, "Udemy", "RAG & Vector Search") {
            Ok(id) => id,
            Err(e) => {
                eprintln!("  upsert failed: {e:#}");
                continue;
            }
        };
        n_courses += 1;
        for (slug, rel) in mappings {
            courses::link_lesson_course(&conn, slug, &id, *rel as f64)?;
            n_links += 1;
        }
    }

    eprintln!(
        "Done. Upserted {n_courses} courses, {n_links} lesson links → {}",
        courses_db.display()
    );
    Ok(())
}

/// Pretty-print one provider's kept items as a `title → slug=score` table
/// (used by the `rag-deep-scrape` `--dry-run`).
fn print_kept_table(provider: &str, kept: &[KeptArticle]) {
    eprintln!("\n── {provider} ── ({} kept)", kept.len());
    for k in kept {
        let pretty: Vec<String> = k
            .slugs
            .iter()
            .map(|(s, r)| format!("{s}={r:.2}"))
            .collect();
        println!(
            "• [{}] {}\n    {}",
            k.topic_group,
            k.course.title,
            pretty.join("  ")
        );
    }
}

/// Unified deep RAG/embeddings scrape across Coursera, DeepLearning.AI, and
/// Udemy. Aggressively BFS-crawls Coursera + DeepLearning.AI with RAG-focused
/// seeds (hard-filtered to the RAG-deep slug set), runs the Udemy RAG seed
/// best-effort, dedups by url across providers, upserts into
/// `data/courses.db`, then regenerates the JSON exports (unless `--no-export`
/// or `--dry-run`).
#[allow(clippy::too_many_arguments)]
async fn cmd_rag_deep_scrape(
    max_per_provider: usize,
    concurrency: usize,
    delay_ms: u64,
    frontier_multiplier: usize,
    udemy_max: usize,
    skip_udemy: bool,
    courses_db: PathBuf,
    repo_root: PathBuf,
    dry_run: bool,
    no_export: bool,
    seed: Vec<String>,
) -> Result<()> {
    let start = Instant::now();
    let seen: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let client = Arc::new(UdemyClient::new(&CrawlConfig::default())?);

    // ── Coursera (RAG-only) ─────────────────────────────────────────────
    // Seeds = RAG article slugs ++ RAG /learn course slugs ++ explicit --seed
    // URLs (verbatim). A /learn/ --seed also becomes the index page so its
    // recommendations rail is parsed immediately.
    let coursera_spec = coursera_spec();
    let mut coursera_seed_paths: Vec<String> = COURSERA_RAG_SEED_ARTICLES
        .iter()
        .map(|s| format!("https://www.coursera.org/articles/{s}"))
        .collect();
    coursera_seed_paths.extend(
        COURSERA_RAG_SEED_COURSES
            .iter()
            .map(|s| format!("https://www.coursera.org/learn/{s}")),
    );
    coursera_seed_paths.extend(seed.iter().cloned());
    let coursera_index = seed
        .iter()
        .find(|u| u.contains("coursera.org/learn/"))
        .cloned()
        .unwrap_or_else(|| COURSERA_ARTICLES_INDEX.to_string());
    let coursera_params = CrawlParams {
        seed_url: coursera_index,
        seed_paths: coursera_seed_paths,
        max_items: max_per_provider,
        concurrency,
        delay_ms,
        frontier_multiplier,
        rag_only: true,
    };
    let (coursera_kept, coursera_counts) = match crawl_provider(
        &coursera_spec,
        coursera_params,
        client.clone(),
        Some(seen.clone()),
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            warn!("coursera crawl failed (continuing): {e:#}");
            (Vec::new(), CrawlCounts::default())
        }
    };

    // ── DeepLearning.AI (RAG-only) ──────────────────────────────────────
    let dl_spec = deeplearning_spec();
    let dl_params = CrawlParams {
        seed_url: DEEPLEARNING_COURSES_INDEX.to_string(),
        seed_paths: DEEPLEARNING_RAG_SEED_COURSES
            .iter()
            .map(|s| format!("https://www.deeplearning.ai/courses/{s}/"))
            .collect(),
        max_items: max_per_provider,
        concurrency,
        delay_ms,
        frontier_multiplier,
        rag_only: true,
    };
    let (dl_kept, dl_counts) =
        match crawl_provider(&dl_spec, dl_params, client.clone(), Some(seen.clone())).await {
            Ok(v) => v,
            Err(e) => {
                warn!("deeplearning crawl failed (continuing): {e:#}");
                (Vec::new(), CrawlCounts::default())
            }
        };

    // ── Udemy (best-effort: Playwright/Cloudflare/pnpm may block) ───────
    let mut udemy_kept: Vec<(serde_json::Value, Vec<(String, f32)>)> = Vec::new();
    if skip_udemy {
        eprintln!("\nUdemy: skipped (--skip-udemy)");
    } else {
        match rag_seed_collect(&repo_root, udemy_max, Some(&seen)) {
            Ok((k, n_irr, n_no)) => {
                eprintln!(
                    "\nUdemy: kept {} ({} irrelevant, {} no RAG-deep slug)",
                    k.len(),
                    n_irr,
                    n_no
                );
                udemy_kept = k;
            }
            Err(e) => warn!("udemy path failed (best-effort): {e:#}"),
        }
    }

    // ── Dry-run: print tables, write nothing ────────────────────────────
    if dry_run {
        print_kept_table(coursera_spec.provider, &coursera_kept);
        print_kept_table(dl_spec.provider, &dl_kept);
        eprintln!("\n── Udemy ── ({} kept)", udemy_kept.len());
        for (c, mappings) in &udemy_kept {
            let title = c.get("title").and_then(|v| v.as_str()).unwrap_or("?");
            let pretty: Vec<String> = mappings
                .iter()
                .map(|(s, r)| format!("{s}={r:.2}"))
                .collect();
            println!("• {title}\n    {}", pretty.join("  "));
        }
        let total = coursera_kept.len() + dl_kept.len() + udemy_kept.len();
        eprintln!(
            "\nrag-deep-scrape (dry-run): {total} unique kept (Coursera {} · DeepLearning.AI {} · Udemy {}) · {} cross-provider dup(s) · nothing written",
            coursera_kept.len(),
            dl_kept.len(),
            udemy_kept.len(),
            coursera_counts.dup + dl_counts.dup
        );
        return Ok(());
    }

    // ── Upsert all three into data/courses.db ───────────────────────────
    let conn = courses::open(&courses_db)
        .with_context(|| format!("opening {}", courses_db.display()))?;
    let (mut n_up, mut n_links) = (0usize, 0usize);

    for k in &coursera_kept {
        let c = &k.course;
        let sections: Vec<String> =
            serde_json::from_str(&c.topics_json).unwrap_or_default();
        // /articles/ → free blog post; /learn/ → Free-Trial/subscription course.
        let is_article = c.url.contains("/articles/");
        let source = if is_article {
            "coursera-article"
        } else {
            "coursera-course"
        };
        let value = serde_json::json!({
            "title": c.title,
            "url": c.url,
            "description": c.description,
            "level": c.level,
            "rating": c.rating,
            "reviewCount": c.review_count,
            "durationHours": c.duration_hours as f64,
            "enrolled": c.num_students,
            "isFree": is_article,
            "imageUrl": c.image_url,
            "language": c.language,
            "metadata": {
                "author": c.instructor,
                "sections": sections,
                "source": source,
            },
        });
        match courses::upsert_course(&conn, &value, coursera_spec.provider, k.topic_group) {
            Ok(id) => {
                n_up += 1;
                for (slug, rel) in &k.slugs {
                    courses::link_lesson_course(&conn, slug, &id, *rel as f64)?;
                    n_links += 1;
                }
            }
            Err(e) => eprintln!("  coursera upsert failed: {e:#}"),
        }
    }

    for k in &dl_kept {
        let c = &k.course;
        let sections: Vec<String> =
            serde_json::from_str(&c.topics_json).unwrap_or_default();
        let value = serde_json::json!({
            "title": c.title,
            "url": c.url,
            "description": c.description,
            "level": c.level,
            "durationHours": c.duration_hours as f64,
            "isFree": true,
            "imageUrl": c.image_url,
            "language": c.language,
            "metadata": {
                "author": c.instructor,
                "sections": sections,
                "source": dl_spec.source,
            },
        });
        match courses::upsert_course(&conn, &value, dl_spec.provider, k.topic_group) {
            Ok(id) => {
                n_up += 1;
                for (slug, rel) in &k.slugs {
                    courses::link_lesson_course(&conn, slug, &id, *rel as f64)?;
                    n_links += 1;
                }
            }
            Err(e) => eprintln!("  deeplearning upsert failed: {e:#}"),
        }
    }

    for (c, mappings) in &udemy_kept {
        let tg = classify_topic_group(&course_text(c));
        match courses::upsert_course(&conn, c, "Udemy", tg) {
            Ok(id) => {
                n_up += 1;
                for (slug, rel) in mappings {
                    courses::link_lesson_course(&conn, slug, &id, *rel as f64)?;
                    n_links += 1;
                }
            }
            Err(e) => eprintln!("  udemy upsert failed: {e:#}"),
        }
    }

    eprintln!(
        "\nUpserted {n_up} course(s), {n_links} lesson link(s) → {}",
        courses_db.display()
    );

    // ── Regenerate JSON exports (unless --no-export) ────────────────────
    if no_export {
        eprintln!("(--no-export: data/content/*.json not regenerated)");
    } else {
        eprintln!(
            "\nExporting content (cargo run -p aer-ml --release --bin export-content) ..."
        );
        let status = std::process::Command::new("cargo")
            .args([
                "run",
                "-p",
                "aer-ml",
                "--release",
                "--bin",
                "export-content",
                "--",
                "--courses-db",
            ])
            .arg(&courses_db)
            .current_dir(repo_root.join("crates/ml"))
            .status()
            .context("spawning export-content (is cargo on PATH?)")?;
        if !status.success() {
            warn!("export-content exited {}", status.code().unwrap_or(-1));
        }
    }

    eprintln!(
        "\n{}\nrag-deep-scrape: Coursera kept {} (fetched {}, failed {}) · DeepLearning.AI kept {} (fetched {}, failed {}) · Udemy kept {} · {} cross-provider dup(s) · {n_up} upserted · {n_links} links · {:.1}s",
        "─".repeat(50),
        coursera_kept.len(),
        coursera_counts.fetched,
        coursera_counts.failed,
        dl_kept.len(),
        dl_counts.fetched,
        dl_counts.failed,
        udemy_kept.len(),
        coursera_counts.dup + dl_counts.dup,
        start.elapsed().as_secs_f64()
    );
    eprintln!(
        "Note: /rag reflects these changes only after a Next.js rebuild (npm run build)."
    );
    Ok(())
}

// ── chapters ───────────────────────────────────────────────────────────────────

async fn cmd_chapters_ingest(
    json: PathBuf,
    db: String,
    embed_url: String,
    batch: usize,
) -> Result<()> {
    let content = std::fs::read_to_string(&json)
        .with_context(|| format!("reading {}", json.display()))?;
    let courses: Vec<UdemyCourseJson> =
        serde_json::from_str(&content).context("parsing udemy_courses JSON")?;
    let chapters: Vec<Chapter> = courses.iter().flat_map(|c| c.chapters()).collect();
    if chapters.is_empty() {
        eprintln!("No curriculum_sections found in {}", json.display());
        return Ok(());
    }
    eprintln!(
        "Extracted {} chapters from {} courses in {}",
        chapters.len(),
        courses.len(),
        json.display()
    );

    let client = reqwest::Client::new();
    client
        .get(format!("{embed_url}/health"))
        .send()
        .await
        .context("embed server not reachable — start it with: cargo run -p candle --bin embed-server --features server")?;

    let store = CourseStore::connect(&db).await?;
    let already = store.count_chapters().await?;
    info!("{already} chapters already in store");

    let total = chapters.len();
    let mut done = 0usize;
    for chunk in chapters.chunks(batch) {
        let texts: Vec<String> = chunk.iter().map(|c| c.embed_text()).collect();
        let vecs = embed_batch(&client, &embed_url, &texts).await?;
        store.add_chapters(chunk, &vecs).await?;
        done += chunk.len();
        eprintln!("  {done}/{total} chapters embedded");
    }
    eprintln!(
        "\nDone — {done} chapters indexed into {db} ({} total rows)",
        already + done
    );
    Ok(())
}

async fn cmd_chapters_of(course_id: String, db: String) -> Result<()> {
    let store = CourseStore::connect(&db).await?;
    let chapters = store.chapters_for_course(&course_id).await?;
    if chapters.is_empty() {
        eprintln!("No chapters for course '{course_id}' — run `udemy chapters ingest` first.");
        return Ok(());
    }
    println!("\n{} — {} chapters\n", course_id, chapters.len());
    for ch in &chapters {
        println!("{:>3}. {}", ch.chapter_index + 1, ch.title);
    }
    Ok(())
}

async fn cmd_chapters_search(
    query: String,
    db: String,
    top: usize,
    embed_url: String,
) -> Result<()> {
    let client = reqwest::Client::new();
    let vec = embed_one(&client, &embed_url, &query).await?;

    let store = CourseStore::connect(&db).await?;
    let results = store.search_chapters(vec, top).await?;
    if results.is_empty() {
        eprintln!("No results — is the chapters table populated? Run `udemy chapters ingest` first.");
        return Ok(());
    }
    println!("\nQuery: \"{query}\"\n");
    println!("Score  Chapter                                        #    Course");
    println!("{}", "-".repeat(92));
    for r in &results {
        let ch = &r.chapter;
        let title: String = ch.title.chars().take(45).collect();
        let course: String = ch.course_title.chars().take(34).collect();
        println!(
            "{:<6.3} {:<46} {:<4} {}",
            r.score,
            title,
            ch.chapter_index + 1,
            course
        );
    }
    Ok(())
}


// ── generate ───────────────────────────────────────────────────────────────────

/// Parse one `.env` line: skips blanks/`#` comments, tolerates a leading
/// `export `, strips surrounding single/double quotes. Returns `None` for
/// lines without a non-empty key.
fn parse_env_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
    let (k, v) = line.split_once('=')?;
    let k = k.trim();
    if k.is_empty() {
        return None;
    }
    let v = v.trim().trim_matches('"').trim_matches('\'');
    Some((k.to_string(), v.to_string()))
}

#[allow(clippy::too_many_arguments)]
async fn cmd_generate(
    slug: String,
    topic: Option<String>,
    category: String,
    related: String,
    db: String,
    embed_url: String,
    content_dir: PathBuf,
    model: Option<String>,
    top_courses: usize,
    top_chapters: usize,
    max_revisions: usize,
    max_tokens: u32,
    env_file: Option<PathBuf>,
    no_write: bool,
) -> Result<()> {
    if let Some(ef) = env_file.as_ref() {
        let text = std::fs::read_to_string(ef)
            .with_context(|| format!("reading env file {}", ef.display()))?;
        for line in text.lines() {
            if let Some((k, v)) = parse_env_line(line) {
                if std::env::var(&k).is_err() {
                    std::env::set_var(&k, v);
                }
            }
        }
    }

    let topic = topic.unwrap_or_else(|| aer_ml::udemy::generate::pipeline::humanize_slug(&slug));
    eprintln!("Generating: {topic} (slug={slug})");
    eprintln!("Pipeline: research -> outline -> draft -> review -> [revise loop] -> finalize");

    let cfg = GenerateConfig {
        slug,
        topic,
        category,
        related_topics: related,
        db_path: db,
        embed_url,
        content_dir,
        model_alias: model,
        top_courses,
        top_chapters,
        max_revisions,
        max_tokens,
        no_write,
    };

    let outcome = generate_article(cfg).await?;

    eprintln!(
        "\nDone! {} words, {} revisions, ok={}",
        outcome.word_count, outcome.revisions, outcome.quality.ok
    );
    if let Some(p) = &outcome.out_path {
        eprintln!("Wrote {}", p.display());
    }
    if !outcome.quality.ok {
        eprintln!("Quality issues:");
        for i in &outcome.quality.issues {
            eprintln!("  - {i}");
        }
    }
    std::process::exit(if outcome.quality.ok { 0 } else { 1 });
}


#[cfg(test)]
mod env_tests {
    use super::parse_env_line;

    #[test]
    fn parse_env_line_handles_export_quotes_and_junk() {
        assert_eq!(parse_env_line("KEY=val"), Some(("KEY".into(), "val".into())));
        assert_eq!(
            parse_env_line("export DEEPSEEK_API_KEY=sk-123"),
            Some(("DEEPSEEK_API_KEY".into(), "sk-123".into()))
        );
        assert_eq!(
            parse_env_line("  Q = \"spaced value\" "),
            Some(("Q".into(), "spaced value".into()))
        );
        assert_eq!(parse_env_line("X='single'"), Some(("X".into(), "single".into())));
        assert_eq!(parse_env_line(""), None);
        assert_eq!(parse_env_line("   "), None);
        assert_eq!(parse_env_line("# comment"), None);
        assert_eq!(parse_env_line("noequals"), None);
        assert_eq!(parse_env_line("=novalue"), None);
    }
}
