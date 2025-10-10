// Generated from svgs/IconCalendar.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCalendar = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6.25 7h3.85v1.1l-2.2 4.4H6.661L8.89 8.148V8.1H6.25z" /><path fillRule="evenodd" d="M3.5.25a.75.75 0 0 1 .75.75h7.5a.75.75 0 0 1 1.5 0h.5A2.25 2.25 0 0 1 16 3.25v10.5A2.25 2.25 0 0 1 13.75 16H2.25A2.25 2.25 0 0 1 0 13.75V3.25A2.25 2.25 0 0 1 2.25 1h.5A.75.75 0 0 1 3.5.25M14.5 5h-13v8.75c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75z" clipRule="evenodd" /></svg>
	);
};

export { IconCalendar as ReactComponent };
