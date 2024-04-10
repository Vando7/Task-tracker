#!/bin/bash

trap 'docker-compose -f ./local.yml down' INT

docker-compose -f ./local.yml up