package gamesession

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RoleOpaqueResolver supplies field 81 without exposing the value to the UI.
type RoleOpaqueResolver interface {
	Resolve(ctx context.Context, serverAddress, characterID string) (string, bool, error)
}

// PCAPRoleOpaqueResolver reads successful role selections from bounded capture files.
type PCAPRoleOpaqueResolver struct {
	paths    []string
	maxFiles int
	maxBytes int64
	maxTotal int64
}

func NewPCAPRoleOpaqueResolver(paths ...string) *PCAPRoleOpaqueResolver {
	cleaned := make([]string, 0, len(paths))
	for _, path := range paths {
		if value := strings.TrimSpace(path); value != "" {
			cleaned = append(cleaned, value)
		}
	}
	return &PCAPRoleOpaqueResolver{
		paths:    cleaned,
		maxFiles: 64,
		maxBytes: 16 * 1024 * 1024,
		maxTotal: 64 * 1024 * 1024,
	}
}

func (r *PCAPRoleOpaqueResolver) Resolve(ctx context.Context, serverAddress, characterID string) (string, bool, error) {
	if err := ctx.Err(); err != nil {
		return "", false, err
	}
	matchedValues := make(map[string]struct{})
	serverValues := make(map[string]struct{})
	globalValues := make(map[string]struct{})
	var totalBytes int64
	for _, path := range capturePaths(r.paths, r.maxFiles) {
		if err := ctx.Err(); err != nil {
			return "", false, err
		}
		remaining := r.maxTotal - totalBytes
		if remaining <= 0 {
			break
		}
		limit := r.maxBytes
		if remaining < limit {
			limit = remaining
		}
		data, err := readCapture(path, limit)
		if err != nil {
			continue
		}
		totalBytes += int64(len(data))
		matched, all := extractPCAPRoleOpaques(data, serverAddress, characterID)
		for _, value := range matched {
			matchedValues[value] = struct{}{}
		}
		for _, value := range all {
			serverValues[value] = struct{}{}
		}
		if len(serverValues) == 0 {
			_, all = extractPCAPRoleOpaques(data, "", characterID)
			for _, value := range all {
				globalValues[value] = struct{}{}
			}
		}
	}
	if len(matchedValues) > 1 {
		return "", false, ErrRoleOpaqueAmbiguous
	}
	if len(matchedValues) == 1 {
		for opaque := range matchedValues {
			return opaque, true, nil
		}
	}
	if len(serverValues) > 1 {
		return "", false, ErrRoleOpaqueAmbiguous
	}
	for opaque := range serverValues {
		return opaque, true, nil
	}
	if len(globalValues) > 1 {
		return "", false, ErrRoleOpaqueAmbiguous
	}
	for opaque := range globalValues {
		return opaque, true, nil
	}
	return "", false, nil
}

func capturePaths(roots []string, maxFiles int) []string {
	paths := make([]string, 0, len(roots))
	seen := make(map[string]struct{})
	for _, root := range roots {
		info, err := os.Stat(root)
		if err != nil {
			continue
		}
		if !info.IsDir() {
			appendCapturePath(&paths, seen, root)
			continue
		}
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || strings.ToLower(filepath.Ext(entry.Name())) != ".pcap" {
				continue
			}
			appendCapturePath(&paths, seen, filepath.Join(root, entry.Name()))
		}
	}
	sort.Strings(paths)
	if len(paths) > maxFiles {
		return paths[:maxFiles]
	}
	return paths
}

func appendCapturePath(paths *[]string, seen map[string]struct{}, path string) {
	cleaned := filepath.Clean(path)
	if _, ok := seen[cleaned]; ok {
		return
	}
	seen[cleaned] = struct{}{}
	*paths = append(*paths, cleaned)
}

func readCapture(path string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, io.ErrShortBuffer
	}
	return data, nil
}
