// Generated from svgs/IconFile.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFile = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.0625);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M9.95 0c.199 0 .39.08.53.22l3.5 3.5c.14.14.22.331.22.53v9A2.75 2.75 0 0 1 11.45 16h-6.5a2.75 2.75 0 0 1-2.75-2.75V2.75A2.75 2.75 0 0 1 4.95 0zm-5 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V5h-1.75A1.75 1.75 0 0 1 9.2 3.25V1.5z" clipRule="evenodd" /></svg>
	);
};

export { IconFile as ReactComponent };
