#!/bin/bash
# Test script to reproduce green text smearing at EOL
# Run this inside openmux to test for rendering artifacts

# ANSI color codes
GREEN_FG="\033[32m"
GREEN_BG="\033[42m"
BRIGHT_GREEN_FG="\033[92m"
BRIGHT_GREEN_BG="\033[102m"
RESET="\033[0m"
BOLD="\033[1m"

echo "=== Green Text Smearing Test ==="
echo ""

# Test 1: Green text with emojis at various positions
echo "--- Test 1: Green foreground with emojis ---"
echo -e "${GREEN_FG}✅ This line has a checkmark at the start${RESET}"
echo -e "${GREEN_FG}This line has a checkmark at the end ✅${RESET}"
echo -e "${GREEN_FG}✅ Multiple ✅ checkmarks ✅ in this line ✅${RESET}"
echo -e "${GREEN_FG}Short line ✅${RESET}"
echo ""

# Test 2: Green background (like diff additions)
echo "--- Test 2: Green background (diff-style) ---"
echo -e "${GREEN_BG}+ Added line with green background${RESET}"
echo -e "${GREEN_BG}+ Line with emoji ✅ and green background${RESET}"
echo -e "${GREEN_BG}+ const { foo, bar } = useLayout(); // ✅ Plain functions${RESET}"
echo -e "${GREEN_BG}+ Short ✅${RESET}"
echo ""

# Test 3: Bright green variants
echo "--- Test 3: Bright green variants ---"
echo -e "${BRIGHT_GREEN_FG}✅ Bright green foreground with emoji${RESET}"
echo -e "${BRIGHT_GREEN_BG}+ Bright green background with emoji ✅${RESET}"
echo ""

# Test 4: Mixed content simulating Claude Code output
echo "--- Test 4: Simulated diff output ---"
echo -e "${GREEN_BG}+ **Safe to destructure (action functions):**${RESET}"
echo -e "${GREEN_BG}+   const { newPane, closePane } = useLayout(); // ✅ Plain functions${RESET}"
echo -e "${GREEN_BG}+   const { createPTY, writeToPTY } = useTerminal(); // ✅ Plain functions${RESET}"
echo -e "${GREEN_BG}+ ${RESET}"
echo -e "${GREEN_BG}+ **Safe to destructure (store proxy):**${RESET}"
echo -e "${GREEN_BG}+   state.workspaces;      // ✅ Reactive - store proxy tracks access${RESET}"
echo -e "${GREEN_BG}+   state.activeWorkspaceId; // ✅ Reactive${RESET}"
echo ""

# Test 5: Lines of varying lengths with green bg
echo "--- Test 5: Varying line lengths with green background ---"
echo -e "${GREEN_BG}Short${RESET}"
echo -e "${GREEN_BG}Medium length line here${RESET}"
echo -e "${GREEN_BG}This is a longer line with more content to test EOL behavior${RESET}"
echo -e "${GREEN_BG}A very long line that should extend quite far across the terminal width to test edge cases at the end of line rendering ✅${RESET}"
echo ""

# Test 6: Rapid updates (scroll test)
echo "--- Test 6: Rapid output (scroll through to test) ---"
for i in {1..20}; do
    echo -e "${GREEN_BG}+ Line $i: Testing green background with emoji ✅ at position $i${RESET}"
done
echo ""

# Test 7: Wide characters other than emojis
echo "--- Test 7: Other wide characters ---"
echo -e "${GREEN_FG}中文字符 Chinese characters${RESET}"
echo -e "${GREEN_BG}+ 日本語 Japanese text ✅${RESET}"
echo -e "${GREEN_FG}한국어 Korean text${RESET}"
echo ""

# Test 8: Emojis at exact EOL boundary
echo "--- Test 8: Content ending exactly at various column positions ---"
printf "${GREEN_BG}%-40s${RESET}\n" "Padded to 40 cols ✅"
printf "${GREEN_BG}%-60s${RESET}\n" "Padded to 60 cols ✅"
printf "${GREEN_BG}%-80s${RESET}\n" "Padded to 80 cols ✅"
echo ""

echo "=== Test Complete ==="
echo "Look for smearing/artifacts at the END of green lines above"
echo "Especially after emoji characters like ✅"
