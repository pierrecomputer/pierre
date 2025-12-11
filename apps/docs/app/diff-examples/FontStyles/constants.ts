import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

export const FONT_STYLES: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'cache.go',
    contents: `package cache

import (
	"sync"
	"time"
)

type Cache struct {
	mu    sync.Mutex
	items map[string]Item
}

type Item struct {
	Value     interface{}
	ExpiresAt time.Time
}

func New() *Cache {
	return &Cache{
		items: make(map[string]Item),
	}
}

func (c *Cache) Set(key string, value interface{}, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[key] = Item{
		Value:     value,
		ExpiresAt: time.Now().Add(ttl),
	}
}

func (c *Cache) Get(key string) (interface{}, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	item, exists := c.items[key]
	if !exists {
		return nil, false
	}

	now := time.Now()
	expired := now.After(item.ExpiresAt)
	if expired {
		delete(c.items, key)
		c.onEviction(key, item.Value)
		return nil, false
	}

	return item.Value, true
}

func (c *Cache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, key)
}

func (c *Cache) onEviction(key string, value interface{}) {
}
`,
  },
  newFile: {
    name: 'cache.go',
    contents: `package cache

import (
	"sync"
	"time"
)

type Cache struct {
	mu    sync.Mutex
	items map[string]Item
}

type Item struct {
	Value     interface{}
	ExpiresAt time.Time
}

func New() *Cache {
	return &Cache{
		items: make(map[string]Item),
	}
}

func (c *Cache) Set(key string, value interface{}, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[key] = Item{
		Value:     value,
		ExpiresAt: time.Now().Add(ttl),
	}
}

func (c *Cache) Get(key string) (interface{}, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	item, exists := c.items[key]
	if !exists {
		return nil, false
	}

	if time.Now().After(item.ExpiresAt) {
		delete(c.items, key)
		return nil, false
	}

	return item.Value, true
}

func (c *Cache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, key)
}

func (c *Cache) onEviction(key string, value interface{}) {
}
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
  },
};
