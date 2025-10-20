// Generated from svgs/IconCreditCard.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCreditCard = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M11.5 9a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5z" /><path fillRule="evenodd" d="M0 3.75A2.75 2.75 0 0 1 2.75 1h12.5A2.75 2.75 0 0 1 18 3.75v8.5A2.75 2.75 0 0 1 15.25 15H2.75A2.75 2.75 0 0 1 0 12.25zM2.75 2.5c-.69 0-1.25.56-1.25 1.25V4h15v-.25c0-.69-.56-1.25-1.25-1.25zM1.5 12.25V7h15v5.25c0 .69-.56 1.25-1.25 1.25H2.75c-.69 0-1.25-.56-1.25-1.25" clipRule="evenodd" /></svg>
	);
};

export { IconCreditCard as ReactComponent };
