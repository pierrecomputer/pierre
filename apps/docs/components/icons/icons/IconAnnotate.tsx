// Generated from svgs/IconAnnotate.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconAnnotate = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v12.5a.75.75 0 0 1-1.122.651L8 13.114 3.122 15.9A.75.75 0 0 1 2 15.25zM4.75 1.5c-.69 0-1.25.56-1.25 1.25v11.208l4.128-2.36a.75.75 0 0 1 .744 0l4.128 2.36V2.75c0-.69-.56-1.25-1.25-1.25z"/><path d="M8.182 3.116a.2.2 0 0 0-.364 0l-.766 1.636a.2.2 0 0 1-.152.114l-1.73.265a.202.202 0 0 0-.113.34l1.264 1.298c.045.046.065.11.055.174l-.297 1.823a.201.201 0 0 0 .296.208l1.528-.846a.2.2 0 0 1 .194 0l1.528.846a.201.201 0 0 0 .296-.208l-.297-1.823a.2.2 0 0 1 .055-.174l1.264-1.298a.202.202 0 0 0-.114-.34L9.1 4.866a.2.2 0 0 1-.15-.114z"/></svg>
	);
};

export { IconAnnotate as ReactComponent };