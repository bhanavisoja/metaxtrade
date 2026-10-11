// Simple MaterialCommunityIcons wrapper so we can swap the vector icon source
// in one place.

import MaterialCommunityIcons from "@react-native-vector-icons/material-design-icons";
import React from "react";

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

export function Icon({
  name,
  size = 22,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}
