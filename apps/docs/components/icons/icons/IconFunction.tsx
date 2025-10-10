// Generated from svgs/IconFunction.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFunction = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M1.75 3.75A2.75 2.75 0 0 1 4.5 1H5a.75.75 0 0 1 0 1.5h-.5c-.69 0-1.25.56-1.25 1.25v2.496a1.75 1.75 0 0 1-1.27 1.682L1.73 8l.25.072a1.75 1.75 0 0 1 1.27 1.682v2.496c0 .69.56 1.25 1.25 1.25H5A.75.75 0 0 1 5 15h-.5a2.75 2.75 0 0 1-2.75-2.75V9.754a.25.25 0 0 0-.181-.24l-.544-.155a1.413 1.413 0 0 1 0-2.718l.544-.155a.25.25 0 0 0 .181-.24zM10.25 1.75A.75.75 0 0 1 11 1h.5a2.75 2.75 0 0 1 2.75 2.75v2.496c0 .111.074.21.181.24l.544.155a1.413 1.413 0 0 1 0 2.717l-.544.156a.25.25 0 0 0-.181.24v2.496A2.75 2.75 0 0 1 11.5 15H11a.75.75 0 0 1 0-1.5h.5c.69 0 1.25-.56 1.25-1.25V9.754a1.75 1.75 0 0 1 1.27-1.682L14.27 8l-.25-.072a1.75 1.75 0 0 1-1.27-1.682V3.75c0-.69-.56-1.25-1.25-1.25H11a.75.75 0 0 1-.75-.75" /><path d="M5.635 9.904a.25.25 0 0 0 .368.075l1.046-.792a.25.25 0 0 1 .399.23l-.163 1.302a.25.25 0 0 0 .248.281h.934a.25.25 0 0 0 .248-.281l-.163-1.302a.25.25 0 0 1 .4-.23l1.045.792a.25.25 0 0 0 .368-.075l.466-.808a.25.25 0 0 0-.119-.356l-1.209-.51a.25.25 0 0 1 0-.46l1.21-.51a.25.25 0 0 0 .119-.356l-.467-.808a.25.25 0 0 0-.368-.075l-1.046.792a.25.25 0 0 1-.399-.23l.163-1.302A.25.25 0 0 0 8.467 5h-.934a.25.25 0 0 0-.248.281l.163 1.302a.25.25 0 0 1-.4.23l-1.045-.792a.25.25 0 0 0-.368.075l-.466.808a.25.25 0 0 0 .119.356l1.209.51a.25.25 0 0 1 0 .46l-1.21.51a.25.25 0 0 0-.118.356z" /></svg>
	);
};

export { IconFunction as ReactComponent };
