// Generated from svgs/IconUnlink.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconUnlink = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M5.813 4.53a.75.75 0 0 1 0-1.06L7.89 1.39a4.75 4.75 0 0 1 6.72 6.72l-1.922 1.921a.75.75 0 0 1-1.06-1.06l1.921-1.922a3.25 3.25 0 0 0-4.596-4.596L6.873 4.53a.75.75 0 0 1-1.06 0M2.452 8.952a3.25 3.25 0 0 0 4.596 4.596l1.922-1.921a.75.75 0 1 1 1.06 1.06L8.11 14.61a4.75 4.75 0 0 1-6.72-6.72l2.08-2.077a.75.75 0 0 1 1.06 1.06zM4 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 4 0M0 4.5a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.5m11.25 10.75a.75.75 0 0 0 1.5 0v-1.5a.75.75 0 0 0-1.5 0zm4-3a.75.75 0 0 0 0-1.5h-1.5a.75.75 0 0 0 0 1.5z"/></svg>
	);
};

export { IconUnlink as ReactComponent };