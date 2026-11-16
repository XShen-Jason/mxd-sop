package autostore

import (
	"database/sql"
	"errors"
)

var ErrIPFailureCapacity = errors.New("IP failure storage is full")

// IPFailureCount reads one indexed record; no credentials or event log is stored.
func (s *Store) IPFailureCount(ip string) (int, error) {
	var count int
	err := s.db.QueryRow("SELECT COALESCE((SELECT failures FROM operator_ip_failures WHERE ip = ?), 0)", ip).Scan(&count)
	return count, err
}

// RecordIPFailure reserves capacity and increments in one SQLite statement. The
// policy owner supplies the ceiling; existing permanent records are never evicted.
func (s *Store) RecordIPFailure(ip string, ceiling, capacity int) (int, error) {
	var count int
	err := s.db.QueryRow(`INSERT INTO operator_ip_failures (ip, failures)
		SELECT ?, 1 WHERE CASE WHEN EXISTS(SELECT 1 FROM operator_ip_failures WHERE ip = ?) THEN 1
		ELSE (SELECT COUNT(*) FROM operator_ip_failures) < ? END
		ON CONFLICT(ip) DO UPDATE SET failures = MIN(failures + 1, ?)
		RETURNING failures`, ip, ip, capacity, ceiling).Scan(&count)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrIPFailureCapacity
	}
	return count, err
}
