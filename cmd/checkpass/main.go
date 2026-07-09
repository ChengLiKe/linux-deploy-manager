package main

import (
	"database/sql"
	"fmt"
	"log"
	_ "github.com/glebarez/sqlite"
	"github.com/linux-deploy-manager/internal/crypto"
)

func main() {
	db, err := sql.Open("sqlite", "C:\\Users\\12613\\AppData\\Roaming\\linux-deploy-manager\\db.sqlite")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rows, err := db.Query("SELECT id, name, host, auth_type, password, server_key_id FROM server_nodes")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var name, host, authType, password string
		var keyID *int
		if err := rows.Scan(&id, &name, &host, &authType, &password, &keyID); err != nil {
			log.Fatal(err)
		}
		fmt.Printf("ID=%d %s (%s) auth=%s", id, name, host, authType)
		if password != "" {
			dec, err := crypto.Decrypt(password)
			if err != nil {
				fmt.Printf(" DECRYPT_ERROR=%v", err)
			} else {
				fmt.Printf(" password=[%s]", string(dec))
			}
		} else {
			fmt.Print(" password=EMPTY")
		}
		if keyID != nil {
			fmt.Printf(" key_id=%d", *keyID)
		}
		fmt.Println()
	}
}
