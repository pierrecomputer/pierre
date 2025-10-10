// Generated from svgs/IconSpelling.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSpelling = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.704 10.078C.694 10.078 0 9.482 0 8.506c0-.928.645-1.524 1.846-1.524H3.11v-.468c0-.518-.312-.806-.854-.806-.527 0-.83.278-.864.693H.19c.04-.864.596-1.665 2.09-1.665 1.192 0 2.1.557 2.1 1.763V10H3.164v-.63H3.11c-.205.381-.644.708-1.406.708m.415-.937c.552 0 .991-.337.991-.84v-.547h-.986c-.566 0-.845.273-.845.669 0 .483.41.718.84.718M8.452 10.068c-.732 0-1.25-.337-1.509-.869h-.048V10h-1.27V2.983h1.29v2.588h.053c.23-.483.805-.82 1.489-.82 1.177 0 1.973.845 1.973 2.427v.454c0 1.548-.777 2.436-1.978 2.436m-.405-1.025c.63 0 1.064-.508 1.064-1.455V7.23c0-.952-.434-1.45-1.064-1.45-.693 0-1.143.493-1.143 1.45v.352c0 .957.445 1.46 1.143 1.46M11.299 7.598v-.43c0-1.436.86-2.441 2.305-2.441 1.308 0 2.104.83 2.133 1.826h-1.186c-.069-.43-.41-.801-.889-.801-.669 0-1.074.547-1.074 1.43v.41c0 .914.415 1.47 1.079 1.47.571 0 .85-.346.908-.742h1.187c-.108 1.158-.938 1.773-2.163 1.773-1.431 0-2.3-.987-2.3-2.495" /><path fillRule="evenodd" d="M3.47 11.47a.75.75 0 0 1 1.06 0L6 12.94l1.47-1.47a.75.75 0 0 1 1.06 0L10 12.94l1.47-1.47a.75.75 0 0 1 1.06 0L14 12.94l.72-.72a.75.75 0 1 1 1.06 1.06l-1.25 1.25a.75.75 0 0 1-1.06 0L12 13.06l-1.47 1.47a.75.75 0 0 1-1.06 0L8 13.06l-1.47 1.47a.75.75 0 0 1-1.06 0L4 13.06l-1.47 1.47a.75.75 0 0 1-1.06 0L.22 13.28a.75.75 0 1 1 1.06-1.06l.72.72z" clipRule="evenodd" /></svg>
	);
};

export { IconSpelling as ReactComponent };
