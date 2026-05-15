pub mod crawler;
pub mod keywords;
pub mod scraper;
pub mod store;
pub mod topic_parser;
pub mod types;

pub use crawler::UdemyClient;
pub use store::CourseStore;
pub use types::{
    Chapter, ChapterSearchResult, Course, CourseSearchResult, CrawlStats, ExternalCourseJson,
    UdemyCourseJson,
};
