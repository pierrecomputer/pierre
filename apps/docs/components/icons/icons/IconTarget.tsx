// Generated from svgs/IconTarget.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTarget = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M6 9a3 3 0 1 1 6 0 3 3 0 0 1-6 0m3-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3" clipRule="evenodd" /><path fillRule="evenodd" d="M9.75 1.6a.75.75 0 0 0-1.5 0v.44a7 7 0 0 0-6.21 6.21H1.6a.75.75 0 1 0 0 1.5h.44a7 7 0 0 0 6.21 6.21v.44a.75.75 0 0 0 1.5 0v-.44a7 7 0 0 0 6.21-6.21h.44a.75.75 0 0 0 0-1.5h-.44a7 7 0 0 0-6.21-6.21zM9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11" clipRule="evenodd" /></svg>
	);
};

export { IconTarget as ReactComponent };
