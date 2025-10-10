// Generated from svgs/IconEnvelope.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconEnvelope = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M0 4.75A2.75 2.75 0 0 1 2.75 2h10.5A2.75 2.75 0 0 1 16 4.75v6.5A2.75 2.75 0 0 1 13.25 14H2.75A2.75 2.75 0 0 1 0 11.25zM2.75 3.5c-.69 0-1.25.56-1.25 1.25v.249L8 7.689l6.5-2.69V4.75c0-.69-.56-1.25-1.25-1.25zM14.5 6.622 8 9.312l-6.5-2.69v4.628c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25z" clipRule="evenodd" /></svg>
	);
};

export { IconEnvelope as ReactComponent };
