// Generated from svgs/IconWaitingFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconWaitingFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m8.5-4.25a.75.75 0 0 0-1.5 0v4.5c0 .276.151.53.394.66l3.25 1.75a.75.75 0 0 0 .712-1.32L8.5 7.802z" /></svg>
	);
};

export { IconWaitingFill as ReactComponent };
