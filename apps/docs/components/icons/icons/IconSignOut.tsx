// Generated from svgs/IconSignOut.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSignOut = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6.25.75A.75.75 0 0 1 7 0h4.25A2.75 2.75 0 0 1 14 2.75v10.5A2.75 2.75 0 0 1 11.25 16H7a.75.75 0 0 1 0-1.5h4.25c.69 0 1.25-.56 1.25-1.25V2.75c0-.69-.56-1.25-1.25-1.25H7a.75.75 0 0 1-.75-.75m-.72 3.47a.75.75 0 0 1 0 1.06L3.56 7.25h5.69a.75.75 0 0 1 0 1.5H3.56l1.97 1.97a.75.75 0 1 1-1.06 1.06L1.22 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0" /></svg>
	);
};

export { IconSignOut as ReactComponent };
