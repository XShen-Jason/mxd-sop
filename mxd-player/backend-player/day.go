package main

import "time"

var beijing, _ = time.LoadLocation("Asia/Shanghai")

// businessDay is the only clock boundary used by player-registration. Keeping
// it in one place makes the midnight reset deterministic and testable.
func businessDay(now time.Time) string {
	return now.In(beijing).Format("2006-01-02")
}

func today() string { return businessDay(time.Now()) }
