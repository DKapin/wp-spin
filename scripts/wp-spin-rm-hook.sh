#!/bin/bash
# wp-spin rm hook - intercepts rm -rf commands on wp-spin directories

# Environment variables:
#   WP_SPIN_AUTO_CLEANUP=true  - Skip prompts and auto-cleanup
#   WP_SPIN_NO_HOOK=true      - Disable hook entirely

# Save original rm command if not already saved
if ! command -v __original_rm >/dev/null 2>&1; then
    eval "$(echo '__original_rm() { command rm "$@"; }')"
fi

# Override rm function
rm() {
    # Check if hook is disabled
    if [[ "$WP_SPIN_NO_HOOK" == "true" ]]; then
        __original_rm "$@"
        return $?
    fi
    
    # Save original arguments
    local original_args=("$@")
    local recursive_flag=""
    local target_dirs=()
    
    # Parse arguments to detect recursive removal
    while [[ $# -gt 0 ]]; do
        case $1 in
            -rf|-fr|-r|--recursive)
                recursive_flag="true"
                ;;
            -*)
                # Other flags, ignore
                ;;
            *)
                # Target directory/file
                target_dirs+=("$1")
                ;;
        esac
        shift
    done
    
    # Only intercept recursive removals
    if [[ "$recursive_flag" == "true" ]]; then
        for target in "${target_dirs[@]}"; do
            # Get absolute path
            local abs_path
            abs_path=$(realpath "$target" 2>/dev/null || echo "$target")
            
            # Check if it's a wp-spin project
            if is_wp_spin_project "$abs_path"; then
                echo ""
                echo "🔍 Detected wp-spin project: $(basename "$abs_path")"
                echo "🐳 This directory contains Docker containers and volumes that should be cleaned up."
                echo ""
                
                # Always perform full cleanup automatically
                echo "🧹 Performing automatic wp-spin cleanup..."
                perform_full_cleanup "$abs_path"
                return $?
            fi
        done
    fi
    
    # For non-wp-spin directories or file-only removal, use original rm
    __original_rm "${original_args[@]}"
}

# Check if directory is a wp-spin project
is_wp_spin_project() {
    local path="$1"
    [[ -f "$path/docker-compose.yml" && -f "$path/.wp-spin" ]] || [[ -d "$path/wp-content" ]]
}


# Perform full wp-spin cleanup
perform_full_cleanup() {
    local project_path="$1"
    
    # Try to use wp-spin remove command if available
    if command -v wpspin >/dev/null 2>&1; then
        if wpspin remove --site="$project_path" 2>/dev/null; then
            echo "✅ wp-spin project removed successfully!"
            return 0
        else
            echo "⚠️  wp-spin remove failed, performing manual cleanup..."
        fi
    fi
    
    # Manual cleanup
    cleanup_manually "$project_path"
}

# Manual cleanup when wp-spin command fails
cleanup_manually() {
    local project_path="$1"
    local project_name=$(basename "$project_path")
    
    echo "🐳 Cleaning up Docker containers and volumes..."
    
    # Stop and remove containers
    if command -v docker >/dev/null 2>&1; then
        docker ps -q --filter "name=$project_name" 2>/dev/null | xargs -r docker stop >/dev/null 2>&1
        docker ps -aq --filter "name=$project_name" 2>/dev/null | xargs -r docker rm >/dev/null 2>&1
        docker volume ls -q --filter "name=$project_name" 2>/dev/null | xargs -r docker volume rm >/dev/null 2>&1
    fi
    
    # Fix permissions using Docker for WordPress files
    echo "🔧 Fixing file permissions..."
    if command -v docker >/dev/null 2>&1; then
        # Use Docker to fix permissions on all files recursively
        docker run --rm -v "$project_path:/workspace" ubuntu:22.04 sh -c "
            chmod -R 755 /workspace 2>/dev/null || true
            chown -R $(id -u):$(id -g) /workspace 2>/dev/null || true
        " >/dev/null 2>&1 || {
            echo "⚠️  Docker permission fix failed, trying sudo..."
            if sudo chmod -R 755 "$project_path" 2>/dev/null && sudo chown -R $(id -u):$(id -g) "$project_path" 2>/dev/null; then
                echo "✅ Permissions fixed with sudo"
            else
                echo "⚠️  Permission fix failed, you may need: sudo rm -rf \"$project_path\""
                return 1
            fi
        }
    else
        # Fallback to sudo if no Docker
        echo "⚠️  Docker not available, trying sudo for permission fix..."
        if sudo chmod -R 755 "$project_path" 2>/dev/null && sudo chown -R $(id -u):$(id -g) "$project_path" 2>/dev/null; then
            echo "✅ Permissions fixed with sudo"
        else
            echo "⚠️  Permission fix failed, you may need: sudo rm -rf \"$project_path\""
            return 1
        fi
    fi
    
    # Remove from wp-spin sites config
    local sites_file="$HOME/.wp-spin/sites.json"
    if [[ -f "$sites_file" ]] && command -v jq >/dev/null 2>&1; then
        echo "📝 Updating wp-spin configuration..."
        local temp_file=$(mktemp)
        if jq --arg path "$project_path" '.sites |= map(select(.path != $path))' "$sites_file" > "$temp_file" 2>/dev/null; then
            mv "$temp_file" "$sites_file"
        else
            rm -f "$temp_file"
        fi
    fi
    
    # Remove the directory
    __original_rm -rf "$project_path"
    echo "✅ wp-spin project removed successfully!"
}

# Export functions so they work in subshells  
export -f rm __original_rm is_wp_spin_project perform_full_cleanup cleanup_manually