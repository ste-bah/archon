use std::collections::HashMap;
use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use crate::config::AppConfig;
use super::utils::validate;

pub const MAX_CONNECTIONS: usize = 100;

pub trait Storage {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&mut self, key: &str, value: String);
    fn delete(&mut self, key: &str) -> bool;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStore {
    data: HashMap<String, String>,
    capacity: usize,
}

impl MemoryStore {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: HashMap::new(),
            capacity,
        }
    }

    fn is_full(&self) -> bool {
        self.data.len() >= self.capacity
    }
}

impl Storage for MemoryStore {
    fn get(&self, key: &str) -> Option<String> {
        self.data.get(key).cloned()
    }

    fn set(&mut self, key: &str, value: String) {
        self.data.insert(key.to_string(), value);
    }

    fn delete(&mut self, key: &str) -> bool {
        self.data.remove(key).is_some()
    }
}

pub enum CachePolicy {
    Lru,
    Fifo,
    Ttl(u64),
}

pub fn create_store(config: &AppConfig) -> Box<dyn Storage> {
    Box::new(MemoryStore::new(config.max_capacity))
}

pub async fn init_storage(path: &str) -> io::Result<MemoryStore> {
    todo!()
}
