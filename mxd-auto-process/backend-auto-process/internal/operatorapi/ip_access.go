package operatorapi

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

const permanentFailureLimit = 20
const maxFailureIPs = 100000

// clientIP trusts only the immediate loopback proxy, and only its last XFF
// address. Nginx overwrites XFF with its Cloudflare-verified remote_addr. Direct
// peers cannot supply their own identity. Mapped IPv4 is canonical IPv4.
func clientIP(request *http.Request) (netip.Addr, error) {
	host := request.RemoteAddr
	if value, _, err := net.SplitHostPort(host); err == nil {
		host = value
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, err
	}
	peer = peer.Unmap()
	if peer.IsLoopback() {
		if forwarded := request.Header.Get("X-Forwarded-For"); forwarded != "" {
			last := forwarded[strings.LastIndex(forwarded, ",")+1:]
			visitor, err := netip.ParseAddr(strings.TrimSpace(last))
			return visitor.Unmap(), err
		}
	}
	return peer, nil
}

// accessAllowed covers new HTTP requests, including static assets and requests
// carrying existing operator/service credentials. It never changes SSH or game
// transport. Permanent counts are read on every request, so manual unban is live.
func (h *Handler) accessAllowed(writer http.ResponseWriter, request *http.Request) bool {
	ip, err := clientIP(request)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_client_ip"})
		return false
	}
	if ip.Is6() {
		writeJSON(writer, http.StatusForbidden, apiError{Error: "ipv6_disabled", Message: "本站仅允许 IPv4 访问，请使用 IPv4 网络"})
		return false
	}
	if h.store != nil {
		count, err := h.store.IPFailureCount(ip.String())
		if err != nil {
			writeJSON(writer, http.StatusServiceUnavailable, apiError{Error: "operator_auth_unavailable"})
			return false
		}
		if count > permanentFailureLimit {
			writePermanentBan(writer)
			return false
		}
	}
	return true
}

func writePermanentBan(writer http.ResponseWriter) {
	writeJSON(writer, http.StatusForbidden, apiError{Error: "ip_permanently_banned", Message: fmt.Sprintf("该 IP 密码错误累计超过 %d 次，已永久封禁，请联系管理员", permanentFailureLimit)})
}
