// Generated from svgs/IconClockArrow.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconClockArrow = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 0.9444444444444444);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 18" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.759.973a.75.75 0 0 1 .75.75v1.511A8 8 0 1 1 .027 9.027a.75.75 0 0 1 1.5 0 6.5 6.5 0 1 0 1.826-4.518h1.941a.75.75 0 1 1 0 1.5H1.76a.75.75 0 0 1-.75-.75V1.723a.75.75 0 0 1 .75-.75M8 4a.75.75 0 0 1 .75.75v4.08l2.893 1.781a.75.75 0 0 1-.786 1.278l-3.25-2a.75.75 0 0 1-.357-.639v-4.5A.75.75 0 0 1 8 4" /></svg>
	);
};

export { IconClockArrow as ReactComponent };
