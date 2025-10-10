// Generated from svgs/IconBranches.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBranches = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M11.5 1.5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM4.5 0A2.5 2.5 0 0 0 2 2.5v11A2.5 2.5 0 0 0 4.5 16h7a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 11.5 0z" /><g opacity=".4"><path d="M1 2a2 2 0 0 0-1 1.732v8.536A2 2 0 0 0 1 14zm14 12a2 2 0 0 0 1-1.732V3.732A2 2 0 0 0 15 2zM7.28 5.97a.75.75 0 0 1 0 1.06L6.31 8l.97.97a.75.75 0 1 1-1.06 1.06l-1.5-1.5a.75.75 0 0 1 0-1.06l1.5-1.5a.75.75 0 0 1 1.06 0m1.44 0a.75.75 0 0 1 1.06 0l1.5 1.5a.75.75 0 0 1 0 1.06l-1.5 1.5a.75.75 0 1 1-1.06-1.06L9.69 8l-.97-.97a.75.75 0 0 1 0-1.06" /></g></svg>
	);
};

export { IconBranches as ReactComponent };
