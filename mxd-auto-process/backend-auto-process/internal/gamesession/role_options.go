package gamesession

func roleOptions(roles []roleCredential) []RoleOption {
	options := make([]RoleOption, 0, len(roles))
	for _, role := range roles {
		options = append(options, role.option)
	}
	return options
}
