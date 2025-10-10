// Generated from svgs/IconFileText.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFileText = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.0625);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 17 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M9.14 10a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1zM11.14 8a.5.5 0 0 1 0 1h-5a.5.5 0 1 1 0-1zM11.14 6a.5.5 0 0 1 0 1h-5a.5.5 0 1 1 0-1zM7.14 4a.5.5 0 0 1 0 1h-1a.5.5 0 1 1 0-1z" /><path fillRule="evenodd" d="M10.39 0c.199 0 .39.08.53.22l3.5 3.5c.14.14.22.331.22.53v9A2.75 2.75 0 0 1 11.89 16h-6.5a2.75 2.75 0 0 1-2.75-2.75V2.75A2.75 2.75 0 0 1 5.39 0zm-5 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h6.5c.69 0 1.25-.56 1.25-1.25V5h-1.75a1.75 1.75 0 0 1-1.75-1.75V1.5z" clipRule="evenodd" /></svg>
	);
};

export { IconFileText as ReactComponent };
