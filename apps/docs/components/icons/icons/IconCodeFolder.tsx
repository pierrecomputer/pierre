// Generated from svgs/IconCodeFolder.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCodeFolder = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1 3.25A2.25 2.25 0 0 1 3.25 1h3.335c.407 0 .807.11 1.157.32L9.53 2.394a.75.75 0 0 0 .385.107h4.835A2.25 2.25 0 0 1 17 4.75v8A2.25 2.25 0 0 1 14.75 15H3.25A2.25 2.25 0 0 1 1 12.75zm2.25-.75a.75.75 0 0 0-.75.75V5h13v-.25a.75.75 0 0 0-.75-.75H9.915a2.25 2.25 0 0 1-1.157-.32L6.97 2.606a.75.75 0 0 0-.385-.107zm6.47 6.03L11.19 10l-1.47 1.47a.75.75 0 1 0 1.06 1.06l2-2a.75.75 0 0 0 0-1.06l-2-2a.75.75 0 1 0-1.06 1.06m-2.5-1.06-2 2a.75.75 0 0 0 0 1.06l2 2a.75.75 0 0 0 1.06-1.06L6.81 10l1.47-1.47a.75.75 0 0 0-1.06-1.06"/></svg>
	);
};

export { IconCodeFolder as ReactComponent };