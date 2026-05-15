pub mod crawler;
pub mod embed;
pub mod generate;
pub mod keywords;
pub mod scraper;
pub mod store;
pub mod topic_parser;
pub mod types;

pub use crawler::UdemyClient;
pub use generate::{generate_article, GenerateConfig, GenerateOutcome};
pub use store::CourseStore;
pub use types::{
    Chapter, ChapterSearchResult, Course, CourseSearchResult, CrawlStats, ExternalCourseJson,
    UdemyCourseJson,
};
