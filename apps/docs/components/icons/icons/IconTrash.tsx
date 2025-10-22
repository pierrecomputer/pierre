// Generated from svgs/IconTrash.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTrash = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6 5.5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0zm2.5 0a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0zm2.5 0a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M5.4.3A.75.75 0 0 1 6 0h4a.75.75 0 0 1 .6.3L11.875 2h2.375a.75.75 0 0 1 0 1.5H14V10c0 2.173-.298 3.783-1.358 4.79C11.592 15.787 9.992 16 8 16c-1.991 0-3.592-.213-4.642-1.21C2.298 13.783 2 12.173 2 10V3.5h-.25a.75.75 0 0 1 0-1.5h2.375zm7.1 3.2h-9V10c0 2.15.327 3.166.892 3.703.575.546 1.6.797 3.608.797s3.033-.25 3.608-.797c.565-.537.892-1.552.892-3.703zM6 2h4l-.375-.5h-3.25z"/></svg>
	);
};

export { IconTrash as ReactComponent };