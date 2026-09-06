package player

import "database/sql"

var servers = []string{"蘑菇", "雪人", "红蜗牛", "UU", "漂漂猪"}
var codeChars = []byte("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

type app struct {
	db           *sql.DB
	serviceToken string
}

const (
	applicationReasonJoinedOtherTeam = "joined-other-team"
	applicationReasonLeftTeam        = "left-team"
	applicationReasonTeamMerged      = "team-merged"
	applicationReasonLeaderRejected  = "leader-rejected"
)

type account struct {
	ID                      int64
	Server, QQ, GameAccount string
	Characters              []string
}

type teamMember struct {
	CharacterID string `json:"characterId"`
	IsLeader    bool   `json:"isLeader"`
}

type teamRequest struct {
	ID          string `json:"requestId"`
	CharacterID string `json:"characterId"`
	RequestedAt string `json:"requestedAt"`
}

type teamMergeRequest struct {
	ID               string `json:"requestId"`
	SourceInviteCode string `json:"sourceInviteCode"`
	BossType         string `json:"bossType"`
	MemberCount      int    `json:"memberCount"`
	RequestedAt      string `json:"requestedAt"`
}

type teamApplication struct {
	ID          string `json:"requestId"`
	BossType    string `json:"bossType"`
	InviteCode  string `json:"inviteCode"`
	CharacterID string `json:"characterId"`
	Status      string `json:"status"`
	Reason      string `json:"reason,omitempty"`
	DayKey      string `json:"day"`
	RequestedAt string `json:"requestedAt"`
}

type team struct {
	ID            string             `json:"-"`
	BossType      string             `json:"bossType"`
	InviteCode    string             `json:"inviteCode"`
	Server        string             `json:"server"`
	Leader        bool               `json:"leader"`
	Members       []teamMember       `json:"members"`
	Pending       []teamRequest      `json:"pendingRequests,omitempty"`
	PendingMerges []teamMergeRequest `json:"pendingMergeRequests,omitempty"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
