// Generated from svgs/IconDesktop.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconDesktop = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M2.25 0A2.25 2.25 0 0 0 0 2.25v7.5A2.25 2.25 0 0 0 2.25 12H6.5v2.5H6A.75.75 0 0 0 6 16h4a.75.75 0 0 0 0-1.5h-.5V12h4.25A2.25 2.25 0 0 0 16 9.75v-7.5A2.25 2.25 0 0 0 13.75 0zM1.5 2.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75z" clipRule="evenodd" /></svg>
	);
};

export { IconDesktop as ReactComponent };
