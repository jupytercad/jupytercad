import * as React from 'react';
import { SuggestionModel } from './model';
import { ReactTree, TreeNodeList } from '@naisutech/react-tree';
import { TREE_THEMES } from '../panelview/objecttree';
import {
  ToolbarButtonComponent,
  checkIcon,
  closeIcon
} from '@jupyterlab/ui-components';
import { visibilityIcon, visibilityOffIcon } from '../tools';

interface ISuggestionProps {
  model: SuggestionModel;
}

export const Suggestion = (props: ISuggestionProps): JSX.Element => {
  const [currentForkId, setCurrentForkId] = React.useState('');
  const [forkData, setForkData] = React.useState<TreeNodeList>([
    { id: 'root', label: props.model.title, parentId: null, items: [] }
  ]);

  const updateFork = React.useCallback(() => {
    const allForks = props.model.allForks;
    const newState = [...forkData];
    newState[0] = {
      ...forkData[0],
      label: props.model.title,
      items: allForks.map(it => ({ id: it, label: it, parentId: 'root' }))
    };
    setForkData(newState);
  }, [props.model, forkData]);
  React.useEffect(() => {
    props.model.contextChanged.connect(updateFork);
    props.model.forksUpdated.connect(updateFork);
    props.model.forkSwitched.connect((_, newForkId) => {
      setCurrentForkId(newForkId);
    });
  }, [props.model, updateFork]);

  return (
    <div className="jcad-Suggestion">
      <div className="jpcad-treeview-wrapper">
        <ReactTree
          multiSelect={false}
          nodes={forkData}
          messages={{ noData: 'No data' }}
          theme={'labTheme'}
          themes={TREE_THEMES}
          openNodes={['root']}
          RenderNode={opts => {
            // const paddingLeft = 25 * (opts.level + 1);
            return (
              <div
                className={`jpcad-control-panel-suggesion ${
                  currentForkId === opts.node.id ? 'selected' : ''
                }`}
              >
                <div
                  style={{
                    paddingLeft: '5px',
                    minHeight: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minWidth: 0
                  }}
                >
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      overflowX: 'hidden'
                    }}
                  >
                    {opts.node.label}
                  </span>
                  {opts.type === 'leaf' ? (
                    <div style={{ display: 'flex' }}>
                      <ToolbarButtonComponent
                        className={'jp-ToolbarButtonComponent'}
                        onClick={async () => {
                          setCurrentForkId(opts.node.id as string);
                          await props.model.checkoutFork(
                            opts.node.id as string,
                            true
                          );
                        }}
                        icon={
                          currentForkId === opts.node.id
                            ? visibilityIcon
                            : visibilityOffIcon
                        }
                      />
                      <ToolbarButtonComponent
                        className={'jp-ToolbarButtonComponent'}
                        onClick={async () => {
                          await props.model.mergeFork(opts.node.id as string);
                        }}
                        icon={checkIcon}
                      />
                      <ToolbarButtonComponent
                        className={'jp-ToolbarButtonComponent'}
                        onClick={() => {
                          /** */
                        }}
                        icon={closeIcon}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          }}
        />
      </div>
    </div>
  );
};
