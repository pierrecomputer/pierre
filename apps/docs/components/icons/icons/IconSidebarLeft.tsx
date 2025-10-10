// Generated from svgs/IconSidebarLeft.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSidebarLeft = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M13.25 2.5c.69 0 1.25.56 1.25 1.25v8.5c0 .69-.56 1.25-1.25 1.25H7.5V15h5.75A2.75 2.75 0 0 0 16 12.25v-8.5A2.75 2.75 0 0 0 13.25 1H7.5v1.5zM6.5 1.75A.75.75 0 0 0 5.75 1h-3A2.75 2.75 0 0 0 0 3.75v8.5A2.75 2.75 0 0 0 2.75 15h3a.75.75 0 0 0 .75-.75zM5 2.5v11H2.75c-.69 0-1.25-.56-1.25-1.25v-8.5c0-.69.56-1.25 1.25-1.25z" /></svg>
	);
};

export { IconSidebarLeft as ReactComponent };
