# pierre-storage-go

Pierre Git Storage SDK for Go.

## Usage

```go
package main

import (
	"context"
	"fmt"
	"log"

	storage "pierre.co/pierre/monorepo/packages/git-storage-sdk-go"
)

func main() {
	client, err := storage.NewClient(storage.Options{
		Name: "your-name",
		Key:  "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
	})
	if err != nil {
		log.Fatal(err)
	}

	repo, err := client.CreateRepo(context.Background(), storage.CreateRepoOptions{})
	if err != nil {
		log.Fatal(err)
	}

	url, err := repo.RemoteURL(context.Background(), storage.RemoteURLOptions{})
	if err != nil {
		log.Fatal(err)
	}

fmt.Println(url)
}
```

### Create a commit

```go
builder, err := repo.CreateCommit(storage.CommitOptions{
	TargetBranch:  "main",
	CommitMessage: "Update docs",
	Author:        storage.CommitSignature{Name: "Docs Bot", Email: "docs@example.com"},
})
if err != nil {
	log.Fatal(err)
}

builder, err = builder.AddFileFromString("docs/readme.md", "# Updated\n", nil)
if err != nil {
	log.Fatal(err)
}

result, err := builder.Send(context.Background())
if err != nil {
	log.Fatal(err)
}

fmt.Println(result.CommitSHA)
```

TTL fields use `time.Duration` values (for example `time.Hour`).

## Features

- Create, list, find, and delete repositories.
- Generate authenticated git remote URLs.
- Read files, list branches/commits, and run grep queries.
- Create commits via streaming commit-pack or diff-commit endpoints.
- Restore commits, manage git notes, and create branches.
- Validate webhook signatures and parse push events.
