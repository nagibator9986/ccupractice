import { createElement, isValidElement } from "react";

// Accepts either a component (lucide icons are forwardRef objects, so a plain
// typeof === "function" check would miss them) or an already-built element.
export default function renderIcon(icon, props) {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  return createElement(icon, props);
}
