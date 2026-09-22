import { IssueContextView } from '../components/IssueContextView';
import { useIssueContextData } from '../hooks/useIssueContextData';

export const IssueContextContainer = () => {
  const model = useIssueContextData();
  return <IssueContextView model={model} />;
};
