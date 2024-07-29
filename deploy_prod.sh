#!/bin/bash

# Read the contents of the files and assign them to variables
google_oauth_client=$(cat ./api_credentials/google_oauth_client)
google_oauth_secret=$(cat ./api_credentials/google_oauth_secret)

# Export the variables as environment variables
export google_oauth_client
export google_oauth_secret

trap 'docker compose -f ./production.yml down' INT

if [[ "$1" == "--rebuild" ]]; then
    echo "Rebuilding Docker images..."
    docker compose -f ./production.yml build
fi

docker compose -f ./production.yml up
