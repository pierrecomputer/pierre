// Generated from svgs/IconArrowsExpand.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconArrowsExpand = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M9 1.75A.75.75 0 0 1 9.75 1h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V3.56l-3.47 3.47a.75.75 0 1 1-1.06-1.06l3.47-3.47H9.75A.75.75 0 0 1 9 1.75M7 14.25a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 1 1.5 0v2.69l3.47-3.47a.75.75 0 0 1 1.06 1.06L3.56 13.5h2.69a.75.75 0 0 1 .75.75" /></svg>
	);
};

export { IconArrowsExpand as ReactComponent };
