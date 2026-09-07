package player

import (
	"errors"
	"net/http"
	"time"
)

type historicalTeam struct {
	BossType string       `json:"bossType"`
	Members  []teamMember `json:"members"`
}

type teamHistoryResponse struct {
	Day   string           `json:"day"`
	Today string           `json:"today"`
	Teams []historicalTeam `json:"teams"`
}

func (a *app) teamHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, errors.New("method-not-allowed"))
		return
	}
	ac, err := a.auth(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	currentDay := today()
	day := r.URL.Query().Get("date")
	if day == "" {
		day = currentDay
	}
	parsed, err := time.Parse("2006-01-02", day)
	if err != nil || parsed.Format("2006-01-02") != day || day > currentDay || day <= "1970-01-01" {
		writeErr(w, errors.New("invalid-input"))
		return
	}
	// Membership authorizes the whole locked roster; pending applications do not.
	rows, err := a.db.QueryContext(r.Context(), `SELECT t.boss_type,m.character_id,m.account_id=t.leader_account_id
FROM player_team_members own
JOIN player_teams t ON t.id=own.team_id
JOIN player_team_members m ON m.team_id=t.id
WHERE own.account_id=? AND own.day_key=? AND t.day_key=? AND t.status='active'
ORDER BY t.boss_type,m.joined_at,m.character_id LIMIT 20`, ac.ID, day, day)
	if err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	defer rows.Close()
	result := teamHistoryResponse{Day: day, Today: currentDay, Teams: []historicalTeam{}}
	for rows.Next() {
		var boss string
		var member teamMember
		if err = rows.Scan(&boss, &member.CharacterID, &member.IsLeader); err != nil {
			writeErr(w, errors.New("internal-error"))
			return
		}
		last := len(result.Teams) - 1
		if last < 0 || result.Teams[last].BossType != boss {
			result.Teams = append(result.Teams, historicalTeam{BossType: boss, Members: []teamMember{}})
			last++
		}
		result.Teams[last].Members = append(result.Teams[last].Members, member)
	}
	if err = rows.Err(); err != nil {
		writeErr(w, errors.New("internal-error"))
		return
	}
	jsonWrite(w, http.StatusOK, result)
}
