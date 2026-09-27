package operatorapi

import "github.com/local/mxd-auto-process/internal/autostore"

// A verification releases only the unresolved delivery it reviewed. Replaying
// the same confirmation cannot release another unknown result from a retry.
func verifyOfflineCommands(execution *autostore.Execution, verificationID string) bool {
	if verificationID == "" {
		return false
	}
	for _, command := range execution.Commands {
		if command.Status == "unknown" && command.OfflineVerificationID == verificationID {
			return false
		}
	}
	for index := range execution.Commands {
		command := &execution.Commands[index]
		if command.Status == "unknown" {
			command.Status = "failure"
			command.Message = "operator verified player offline and delivery not received"
			command.OfflineVerificationID = verificationID
		}
	}
	return true
}
