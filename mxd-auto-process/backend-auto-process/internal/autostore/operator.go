package autostore

func (s *Store) Operator() (OperatorState, error) {
	var state OperatorState
	var mustChange int
	err := s.db.QueryRow("SELECT username, must_change FROM operator WHERE id = 1").Scan(&state.Username, &mustChange)
	if err != nil {
		return OperatorState{}, err
	}
	state.MustChange = mustChange != 0
	return state, nil
}

func (s *Store) VerifyOperator(username, password string) (bool, bool, error) {
	state, err := s.Operator()
	if err != nil {
		return false, false, err
	}
	var encoded string
	if err := s.db.QueryRow("SELECT password_hash FROM operator WHERE id = 1").Scan(&encoded); err != nil {
		return false, false, err
	}
	if username != state.Username || !verifyPassword(password, encoded) {
		return false, false, nil
	}
	return true, state.MustChange, nil
}

func (s *Store) ChangeOperatorPassword(username, current, next string) error {
	if len(next) < minOperatorPasswordSize || len(next) > 512 || current == next {
		return ErrInvalidPassword
	}
	valid, _, err := s.VerifyOperator(username, current)
	if err != nil {
		return err
	}
	if !valid {
		return ErrInvalidPassword
	}
	hash, err := hashPassword(next)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("UPDATE operator SET password_hash = ?, must_change = 0 WHERE id = 1", hash)
	return err
}
