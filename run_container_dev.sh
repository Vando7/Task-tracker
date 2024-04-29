#!/bin/bash

# Read the contents of the files and assign them to variables
google_oauth_client=$(cat /home/vanko/personal_projects/tracker/api_credentials/google_oauth_client)
google_oauth_secret=$(cat /home/vanko/personal_projects/tracker/api_credentials/google_oauth_secret)

# Export the variables as environment variables
export google_oauth_client
export google_oauth_secret

trap 'docker-compose -f /home/vanko/personal_projects/tracker/local.yml down' INT

docker-compose -f /home/vanko/personal_projects/tracker/local.yml up
