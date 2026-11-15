package operatorapi

import "errors"

// validateServiceToken permits an empty value for cookie-only operation.
// A configured service credential must be explicit and nontrivial; its value
// must never enter errors/logs. Provision cryptographically random bytes, since
// length validation alone cannot establish entropy.
func validateServiceToken(token string) error {
	if token == "" {
		return nil
	}
	valid := len(token) >= 32 && len(token) <= 512
	for _, value := range []byte(token) {
		valid = valid && value >= 0x21 && value <= 0x7e
	}
	if !valid {
		return errors.New("AUTO_SERVICE_TOKEN must contain 32-512 non-space ASCII characters; generate a random secret or leave it unset to disable service authentication")
	}
	return nil
}
