package servercatalog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

type HeartbeatSettings struct {
	Enabled         bool `json:"enabled"`
	IntervalSeconds int  `json:"interval_seconds"`
	Operation       int  `json:"operation"`
}

type ServerConfig struct {
	ID                         string            `json:"id"`
	Name                       string            `json:"name"`
	Address                    string            `json:"address"`
	Version                    string            `json:"version"`
	MapID                      string            `json:"map_id"`
	Enabled                    bool              `json:"enabled"`
	MaxBodyBytes               uint32            `json:"max_body_bytes"`
	ConnectTimeoutSeconds      int               `json:"connect_timeout_seconds"`
	RequestTimeoutSeconds      int               `json:"request_timeout_seconds"`
	ChatResponseTimeoutSeconds int               `json:"chat_response_timeout_seconds"`
	MapReadyTimeoutSeconds     int               `json:"map_ready_timeout_seconds"`
	RequireMapEvents           *bool             `json:"require_map_events"`
	PostEntryInit              *bool             `json:"post_entry_init"`
	ServerKeyFieldID           int               `json:"server_key_field_id"`
	RetentionMode              string            `json:"retention_mode"`
	AllowKeylessProbe          bool              `json:"allow_keyless_probe"`
	Heartbeat                  HeartbeatSettings `json:"heartbeat"`
}

type PublicInfo struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Address      string `json:"address"`
	Version      string `json:"version"`
	MapID        string `json:"map_id"`
	Enabled      bool   `json:"enabled"`
	KeylessProbe bool   `json:"keyless_probe_enabled"`
}

type Catalog struct {
	mu          sync.RWMutex
	servers     map[string]ServerConfig
	path        string
	persistence Persistence
}

type Persistence interface {
	LoadServerCatalog() ([]ServerConfig, bool, error)
	SaveServerCatalog([]ServerConfig) error
}

// RemovalPersistence lets a database-backed catalog remove its dependent
// accounts and replace the catalog document in one transaction.
type RemovalPersistence interface {
	RemoveServer(string, []ServerConfig) error
}

func Load(path string) (*Catalog, error) {
	return load(path, nil)
}

func LoadWithPersistence(path string, persistence Persistence) (*Catalog, error) {
	return load(path, persistence)
}

func load(path string, persistence Persistence) (*Catalog, error) {
	if persistence != nil {
		entries, found, err := persistence.LoadServerCatalog()
		if err != nil {
			return nil, fmt.Errorf("load persisted server catalog: %w", err)
		}
		if found {
			catalog, err := New(entries)
			if err != nil {
				return nil, err
			}
			catalog.persistence = persistence
			return catalog, nil
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read server catalog: %w", err)
	}
	var document struct {
		Servers []ServerConfig `json:"servers"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("decode server catalog: %w", err)
	}
	catalog, err := New(document.Servers)
	if err != nil {
		return nil, err
	}
	catalog.path = path
	catalog.persistence = persistence
	if persistence != nil {
		if err := persistence.SaveServerCatalog(catalog.listLocked()); err != nil {
			return nil, fmt.Errorf("persist initial server catalog: %w", err)
		}
	}
	return catalog, nil
}

func New(entries []ServerConfig) (*Catalog, error) {
	servers := make(map[string]ServerConfig, len(entries))
	for _, entry := range entries {
		entry = upgradeLegacyDefaults(entry)
		entry = withDefaults(entry)
		if err := validate(entry); err != nil {
			return nil, err
		}
		if _, exists := servers[entry.ID]; exists {
			return nil, fmt.Errorf("duplicate server id %q", entry.ID)
		}
		servers[entry.ID] = entry
	}
	return &Catalog{servers: servers}, nil
}

func (c *Catalog) Get(id string) (ServerConfig, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.servers[id]
	return entry, ok
}

func (c *Catalog) List() []ServerConfig {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.listLocked()
}

func (c *Catalog) Upsert(entry ServerConfig) error {
	entry = withDefaults(entry)
	if err := validate(entry); err != nil {
		return err
	}
	c.mu.Lock()
	candidate := c.copyLocked()
	candidate[entry.ID] = entry
	err := c.saveEntriesLocked(listServers(candidate))
	if err == nil {
		c.servers = candidate
	}
	c.mu.Unlock()
	return err
}

func (c *Catalog) Remove(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.servers[id]; !ok {
		return fmt.Errorf("server %q not found", id)
	}
	candidate := c.copyLocked()
	delete(candidate, id)
	entries := listServers(candidate)
	if remover, ok := c.persistence.(RemovalPersistence); ok {
		if err := remover.RemoveServer(id, entries); err != nil {
			return err
		}
	} else if err := c.saveEntriesLocked(entries); err != nil {
		return err
	}
	c.servers = candidate
	return nil
}

func (c *Catalog) listLocked() []ServerConfig {
	return listServers(c.servers)
}

func (c *Catalog) PublicList() []PublicInfo {
	entries := c.List()
	result := make([]PublicInfo, 0, len(entries))
	for _, entry := range entries {
		result = append(result, PublicInfo{ID: entry.ID, Name: entry.Name, Address: entry.Address, Version: entry.Version, MapID: entry.MapID, Enabled: entry.Enabled, KeylessProbe: entry.AllowKeylessProbe})
	}
	return result
}

func (c *Catalog) saveLocked() error {
	return c.saveEntriesLocked(c.listLocked())
}

func (c *Catalog) saveEntriesLocked(entries []ServerConfig) error {
	if c.persistence != nil {
		return c.persistence.SaveServerCatalog(entries)
	}
	if c.path == "" {
		return nil
	}
	document := struct {
		Servers []ServerConfig `json:"servers"`
	}{Servers: entries}
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode server catalog: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0o755); err != nil {
		return fmt.Errorf("create server catalog directory: %w", err)
	}
	temporary := c.path + ".tmp"
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return fmt.Errorf("write server catalog: %w", err)
	}
	if err := os.Rename(temporary, c.path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("replace server catalog: %w", err)
	}
	return nil
}

func (c *Catalog) copyLocked() map[string]ServerConfig {
	result := make(map[string]ServerConfig, len(c.servers)+1)
	for id, entry := range c.servers {
		result[id] = entry
	}
	return result
}

func listServers(servers map[string]ServerConfig) []ServerConfig {
	entries := make([]ServerConfig, 0, len(servers))
	for _, entry := range servers {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries
}
