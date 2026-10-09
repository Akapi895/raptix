import React from "react";
import { Text, Box } from "ink";

// ── Full banner: RAPTIX logo + text art ───────────────────────────────
const BANNER_FULL = `
	⠀⠀⠀⠀⠀⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠄
	⠀⠀⠀⠀⠀⠘⣿⣶⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⣿⠏
	⠀⠀⠀⠀⠀⠀⠘⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⠏
	⠀⠀⠀⠀⠀⠀⠀⠈⢿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⡿⠁
	⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⠏
	⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢻⣿⣿⣿⣷⣄⠀⠀⣠⣾⣿⣿⣿⡟⠁
	⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⣿⣿⣿⣿⣷⣾⣿⣿⣿⣿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ⠀⠀⠀  ██████╗   █████╗ ██████╗ ████████╗██╗██╗  ██╗
	⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ⠀⠀  ██╔══██╗ ██╔══██╗██╔══██╗╚══██╔══╝██║╚██╗██╔╝
	⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣼⣿⣿⣿⣿⣿⣿⣧⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ⠀  ██████╔╝ ███████║██████╔╝   ██║   ██║ ╚███╔╝
	⠀⠀⠀⠀⠀⠀⠀⠀⡀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ⠀  ██╔══██╗ ██╔══██║██╔═══╝    ██║   ██║ ██╔██╗
	⠀⠀⠀⠀⠀⣼⣿⣿⣿⡄⣴⣿⣿⣿⣿⣿⡿⠃⠘⢿⣿⣿⣿⣿⣿⣦⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀ ██║   ██║██║  ██║██║        ██║   ██║██╔╝ ██╗
	⠀⠀⠀⠀⠀⠀⠙⣻⣿⣿⣿⣿⣿⣿⣿⠟⠀⠀⠀⠀⠻⣿⣿⣿⣿⣿⣿⣿⣟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ╚═╝   ╚═╝╚═╝  ╚═╝╚═╝        ╚═╝   ╚═╝╚═╝  ╚═╝
	⠀⠀⠀⠀⠀⠀⠀⢈⣿⣿⣿⣿⣿⣟⡁⠀⠀⠀⠀⠀⠀⢈⣻⣿⣿⣿⣿⣿⡁
	⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⠟⢿⠿⣿⣿⣿⠀⠀⠀⠀⣿⣿⣿⠿⡿⠻⣿⣿⣿⣄
	⠀⠀⠀⣠⣤⣾⣿⣿⡿⠃⠀⠀⠀⠙⠟⠛⠀⠀⠀⠀⠛⠻⠋⠀⠀⠀⠘⢿⣿⣿⣷⣤⣄
	⠀⠀⣾⣿⣿⣿⣿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⣿⣿⣿⣿⣷
	⠀⠀⠻⣿⣿⣿⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠻⣿⣿⣿⠟
⠀⠀⠀⠈⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠁
`.replace(/^\t/gm, "").trim();

// ── Banner processing ────────────────────────────────────────────────

// Chia banner thành từng dòng
const bannerLines = BANNER_FULL.split("\n");

// Vị trí bắt đầu của chữ RAPTIX
const TEXT_START_ROW = 6;
const TEXT_ROW_COUNT = 6;

// Dấu phân cách: 3 dấu cách ASCII trước chữ block art
const TEXT_SEPARATOR = / {3}(?=[█╔╚])/u;

// Tách phần logo, giữ nguyên hình braille
const BANNER_LOGO = bannerLines
  .map((line) => {
    const index = line.search(TEXT_SEPARATOR);

    const logoPart =
      index === -1
        ? line
        : line.slice(0, index);

    return logoPart.replace(/[ \t\u2800]+$/gu, "");
  })
  .join("\n");

// Tách phần chữ RAPTIX
const BANNER_TEXT = bannerLines
  .slice(TEXT_START_ROW, TEXT_START_ROW + TEXT_ROW_COUNT)
  .map((line) => {
    const index = line.search(TEXT_SEPARATOR);

    if (index === -1) {
      return "";
    }

    return line.slice(index + 3);
  })
  .join("\n");

// ── Banner component ─────────────────────────────────────────────────

export const Banner = React.memo(function Banner() {
  return (
    <Box
      flexDirection="row"
      alignItems="flex-start"
      flexWrap="nowrap"
    >
      {/* Logo bên trái */}
      <Box flexShrink={0}>
        <Text color="red" wrap="truncate-end">
          {BANNER_LOGO}
        </Text>
      </Box>

      {/* Chữ RAPTIX bên phải */}
      <Box
        flexShrink={0}
        marginLeft={3}
        marginTop={TEXT_START_ROW}
      >
        <Text color="red" wrap="truncate-end">
          {BANNER_TEXT}
        </Text>
      </Box>
    </Box>
  );
});