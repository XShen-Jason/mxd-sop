package player

import (
	"log"
	"net/http"
	"time"
)

func Run() {
	config := loadPlayerConfig()
	db, err := openPlayerDatabase(config.DatabasePath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	if err = migrate(db); err != nil {
		log.Fatal(err)
	}
	seed(db)

	server := &http.Server{
		Addr:              config.Host + ":" + config.Port,
		Handler:           newPlayerRouter(&app{db: db, serviceToken: config.ServiceToken}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("mxd-player backend listening on %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}
