package main

import (
	"fmt"
	"log"
	"os"

	"github.com/linux-deploy-manager/internal/crypto"
	"github.com/linux-deploy-manager/internal/model"
	"github.com/linux-deploy-manager/internal/remote/sshclient"
)

func main() {
	encrypted := os.Getenv("PW")
	if encrypted == "" {
		log.Fatal("set PW env var")
	}

	decrypted, _ := crypto.Decrypt(encrypted)
	fmt.Printf("password=%q\n", string(decrypted))

	node := &model.ServerNode{
		Host:     "139.196.196.184",
		Port:     22,
		User:     "root",
		AuthType: "password",
		Password: encrypted,
	}
	c, err := sshclient.NewClientFromNode(node, nil)
	if err != nil {
		log.Fatalf("FAIL: %v", err)
	}
	c.Close()
	fmt.Println("OK")
}
