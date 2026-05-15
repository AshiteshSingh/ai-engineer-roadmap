pub mod error;
pub mod rules;
pub mod scanner;
pub mod store;
pub mod taxonomy;
pub mod topic;

pub use error::{Error, Result};
pub use scanner::scan;
pub use store::TopicStore;
pub use taxonomy::TAXONOMY;
pub use topic::{aggregate, Evidence, RawSignal, Topic};
