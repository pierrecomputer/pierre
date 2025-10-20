// Generated from svgs/IconFolder.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFolder = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M3.25 1A2.25 2.25 0 0 0 1 3.25v9.5A2.25 2.25 0 0 0 3.25 15h11.5A2.25 2.25 0 0 0 17 12.75v-8a2.25 2.25 0 0 0-2.25-2.25H9.915a.75.75 0 0 1-.385-.107L7.742 1.321A2.25 2.25 0 0 0 6.585 1zM2.5 3.25a.75.75 0 0 1 .75-.75h3.335a.75.75 0 0 1 .385.107l1.788 1.072c.35.21.75.321 1.157.321h4.835a.75.75 0 0 1 .75.75V5h-13z" /></svg>
	);
};

export { IconFolder as ReactComponent };
