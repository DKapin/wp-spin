#!/bin/bash
# Setup script for wp-spin rm hook

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/wp-spin-rm-hook.sh"

# Detect shell
if [[ -n "$ZSH_VERSION" ]]; then
    SHELL_RC="$HOME/.zshrc"
    SHELL_NAME="zsh"
elif [[ -n "$BASH_VERSION" ]]; then
    SHELL_RC="$HOME/.bashrc"
    SHELL_NAME="bash"
else
    echo "⚠️  Unsupported shell. Please manually source the hook script."
    echo "Add this to your shell RC file:"
    echo "source '$HOOK_SCRIPT'"
    exit 1
fi

echo "🔧 Setting up wp-spin rm hook for $SHELL_NAME..."

# Check if already installed
if grep -q "wp-spin-rm-hook.sh" "$SHELL_RC" 2>/dev/null; then
    echo "✅ wp-spin rm hook is already installed!"
    echo "🔄 To reload: source $SHELL_RC"
    exit 0
fi

# Add hook to shell RC
echo "" >> "$SHELL_RC"
echo "# wp-spin rm hook - automatically cleanup wp-spin projects on rm -rf" >> "$SHELL_RC"
echo "source '$HOOK_SCRIPT'" >> "$SHELL_RC"

echo "✅ wp-spin rm hook installed successfully!"
echo "🔄 To activate: source $SHELL_RC"
echo "Or restart your terminal."

echo ""
echo "📖 Usage:"
echo "  rm -rf my-wordpress-site/  # Will automatically run wp-spin cleanup"
echo "  rm file.txt               # Regular rm behavior unchanged"

# Offer to source immediately
read -p "🚀 Would you like to activate the hook now? (y/N): " -r
if [[ $REPLY =~ ^[Yy]$ ]]; then
    source "$SHELL_RC"
    echo "✅ Hook activated! Try: rm -rf [wp-spin-directory]"
fi