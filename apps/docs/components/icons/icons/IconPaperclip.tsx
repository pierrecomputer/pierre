// Generated from svgs/IconPaperclip.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPaperclip = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M11.97 2.53a2.08 2.08 0 0 0-2.94 0l-5.5 5.5a3.493 3.493 0 0 0 4.94 4.94l5-5a.75.75 0 1 1 1.06 1.06l-5 5a4.993 4.993 0 1 1-7.06-7.06l5.5-5.5a3.578 3.578 0 1 1 5.06 5.06l-5.5 5.5a2.164 2.164 0 1 1-3.06-3.06l5-5a.75.75 0 1 1 1.06 1.06l-5 5a.664.664 0 0 0 .94.94l5.5-5.5a2.08 2.08 0 0 0 0-2.94" clipRule="evenodd" /></svg>
	);
};

export { IconPaperclip as ReactComponent };
