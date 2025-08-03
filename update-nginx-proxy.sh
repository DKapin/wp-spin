#!/bin/bash

# Function to check if a port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null ; then
        return 0
    else
        return 1
    fi
}

# Function to find next available port
find_next_port() {
    local port=8080
    while check_port $port; do
        port=$((port + 1))
    done
    echo $port
}

# Function to update nginx config for a site
update_site_config() {
    local site_name=$1
    local port=$2
    local config_file="${site_name}.test.conf"
    
    if [ ! -f "$config_file" ]; then
        echo "Error: Configuration file $config_file not found"
        exit 1
    fi
    
    # Update the proxy_pass line in the config file
    sed -i '' "s/proxy_pass http:\/\/host.docker.internal:[0-9]*;/proxy_pass http:\/\/host.docker.internal:$port;/" "$config_file"
    echo "Updated $config_file to use port $port"
}

# Main script
if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <site_name> [port]"
    echo "Example: $0 wpspin-test"
    echo "Example with specific port: $0 wpspin-test 8081"
    exit 1
fi

SITE_NAME=$1
PORT=${2:-$(find_next_port)}

# Update the nginx configuration
update_site_config "$SITE_NAME" "$PORT"

# Restart the nginx proxy container
echo "Restarting nginx proxy container..."
docker restart wp-spin-nginx-proxy

echo "Done! Site $SITE_NAME is now configured to use port $PORT" 